"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

interface SessionData {
  userId?: number;
  username?: string;
  isLoggedIn: boolean;
}

const sessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "campflow-default-secret-change-me-in-production-32chars!",
  cookieName: "campflow-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 dage
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function login(username: string, password: string) {
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
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

export async function requireAuth() {
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

// Bruges til at oprette/ændre admin-brugere
export async function createUser(username: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { username, passwordHash: hash },
  });
}

export async function changePassword(userId: number, newPassword: string) {
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash },
  });
}
