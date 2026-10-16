"use server";

import { cache } from "react";
import { createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { isApiAuthenticated } from "./auth-context";
import { hitCount, isLimited, recordHit, resetLimit } from "./rate-limit";
import { clientIpFromHeaders } from "./client-ip";
import { deleteMcpApiKey } from "./mcp/oauth";

interface SessionData {
  userId?: number;
  username?: string;
  isLoggedIn: boolean;
  /** Fingerprint of the password hash at login — a password change ends old sessions. */
  pwv?: string;
}

if (!process.env.SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET env var is required. Generate one with: openssl rand -base64 32",
  );
}

const sessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: "campsense-session",
  cookieOptions: {
    secure: process.env.FORCE_HTTPS === "true",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 dage
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

// Brute-force guard: the admin password is all that stands between the
// internet and every guest record (and, via MCP approval, Claude access).
// Only failures count, so normal logins never use up the budget. The hard
// block is per (username, IP) and per IP, so nobody can lock the admin out
// from elsewhere; per username alone there is only a growing delay.
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_USER_IP = 10;
const MAX_FAILS_PER_IP = 30;
const USER_FAILS_BEFORE_DELAY = 20;

const pwFingerprint = (passwordHash: string) =>
  createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);

export async function login(username: string, password: string): Promise<{ error?: string; success?: boolean }> {
  const invalid = { error: "Forkert brugernavn eller adgangskode" };
  try {
    if (typeof username !== "string" || typeof password !== "string") return invalid;
    // Bounded before anything is keyed, logged or hashed.
    if (username.length > 64 || password.length > 256) return invalid;

    const ip = clientIpFromHeaders(await headers());
    const user_ = username.toLowerCase();
    const userIpKey = `login:user-ip:${user_}:${ip}`;
    const ipKey = `login:ip:${ip}`;
    const userKey = `login:user:${user_}`;
    if (isLimited(userIpKey, MAX_FAILS_PER_USER_IP) || isLimited(ipKey, MAX_FAILS_PER_IP)) {
      logger.warn("auth", "Login throttled", { ip, username: username.slice(0, 64) });
      return { error: "For mange loginforsøg. Prøv igen om et kvarter." };
    }
    const userFails = hitCount(userKey);
    if (userFails > USER_FAILS_BEFORE_DELAY) {
      await new Promise((r) => setTimeout(r, Math.min(5000, (userFails - USER_FAILS_BEFORE_DELAY) * 250)));
    }

    const user = await prisma.user.findUnique({ where: { username } });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid) {
      recordHit(userIpKey, LOGIN_WINDOW_MS);
      recordHit(ipKey, LOGIN_WINDOW_MS);
      recordHit(userKey, LOGIN_WINDOW_MS);
      return invalid;
    }
    resetLimit(userIpKey);
    resetLimit(ipKey);

    const session = await getSession();
    session.userId = user.id;
    session.username = user.username;
    session.isLoggedIn = true;
    session.pwv = pwFingerprint(user.passwordHash);
    await session.save();

    return { success: true };
  } catch (e) {
    logger.error("auth", "Login fejl", e);
    return { error: "Der opstod en serverfejl. Tjek logs." };
  }
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

/** Current password fingerprint for a user, once per request. */
const currentPwv = cache(async (userId: number): Promise<string | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return user ? pwFingerprint(user.passwordHash) : null;
});

/**
 * The session only counts while the password it was created with is still
 * current — changing the password logs out every other browser.
 */
async function isSessionCurrent(session: SessionData): Promise<boolean> {
  if (!session.isLoggedIn || !session.userId || !session.pwv) return false;
  return (await currentPwv(session.userId)) === session.pwv;
}

export async function requireAuth() {
  if (isApiAuthenticated()) {
    return { isLoggedIn: true as const, userId: 0, username: "api" };
  }
  const session = await getSession();
  // Cookies can't be cleared from a server component render, so a stale
  // session just goes to /login (where isAuthenticated agrees it's invalid).
  if (!(await isSessionCurrent(session))) {
    redirect("/login");
  }
  return session;
}

export async function isAuthenticated() {
  return isSessionCurrent(await getSession());
}

/** The logged-in admin (id + name) when the session is current, else null. */
export async function getVerifiedAdmin(): Promise<{ userId: number; username: string } | null> {
  const session = await getSession();
  if (!(await isSessionCurrent(session))) return null;
  return { userId: session.userId!, username: session.username ?? "" };
}

/**
 * Change the logged-in admin's own password. The user comes from the session,
 * never from the caller — this is a public server action. In case the old
 * password leaked, it also ends every other session (see isSessionCurrent),
 * revokes the admin's Claude/MCP grants and pending codes, and deletes the
 * static MCP read key.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireAuth();
  if (!auth.userId) return { error: "Kun en indlogget admin kan skifte adgangskode" };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 256) {
    return { error: "Adgangskoden skal være mellem 6 og 256 tegn" };
  }

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return { error: "Den nuværende adgangskode er forkert" };
  }

  const hash = await bcrypt.hash(newPassword, 10);
  const now = new Date();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await prisma.mcpOAuthToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
  await prisma.mcpOAuthCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  await deleteMcpApiKey();

  // Keep this browser logged in; every other session is now stale.
  const session = await getSession();
  session.pwv = pwFingerprint(hash);
  await session.save();

  logger.info("auth", "Password changed; other sessions, MCP grants and MCP key revoked", { userId: user.id });
  return { success: true };
}
