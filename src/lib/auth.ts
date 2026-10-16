"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { isApiAuthenticated } from "./auth-context";
import { rateLimit } from "./rate-limit";

interface SessionData {
  userId?: number;
  username?: string;
  isLoggedIn: boolean;
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
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_PER_IP = 10;
const LOGIN_MAX_PER_USER = 10;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function login(username: string, password: string) {
  try {
    if (typeof username !== "string" || typeof password !== "string") {
      return { error: "Forkert brugernavn eller adgangskode" };
    }
    const ip = await clientIp();
    const byIp = rateLimit(`login:ip:${ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS);
    const byUser = rateLimit(`login:user:${username.toLowerCase()}`, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS);
    if (!byIp.ok || !byUser.ok) {
      logger.warn("auth", "Login throttled", { ip, username });
      return { error: "For mange loginforsøg. Prøv igen om et kvarter." };
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return { error: "Forkert brugernavn eller adgangskode" };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { error: "Forkert brugernavn eller adgangskode" };
    }

    const session = await getSession();
    session.userId = user.id;
    session.username = user.username;
    session.isLoggedIn = true;
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

export async function requireAuth() {
  if (isApiAuthenticated()) {
    return { isLoggedIn: true as const, userId: 0, username: "api" };
  }
  const session = await getSession();
  if (!session.isLoggedIn) {
    redirect("/login");
  }
  return session;
}

export async function isAuthenticated() {
  const session = await getSession();
  return session.isLoggedIn === true;
}

/**
 * Change the logged-in admin's own password. The user comes from the session,
 * never from the caller — this is a public server action. Also cuts every
 * Claude/MCP grant that admin approved, in case the old password leaked.
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  const session = await requireAuth();
  if (!session.userId) return { error: "Kun en indlogget admin kan skifte adgangskode" };
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 6) {
    return { error: "Adgangskoden skal være mindst 6 tegn" };
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return { error: "Den nuværende adgangskode er forkert" };
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await prisma.mcpOAuthToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  logger.info("auth", "Password changed; MCP grants revoked", { userId: user.id });
  return { success: true };
}
