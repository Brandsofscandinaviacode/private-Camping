import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function resolveDbUrl(url: string): string {
  // Konvertér relativ file: sti til absolut, så den virker uanset CWD
  if (url.startsWith("file:") && !url.startsWith("file:/")) {
    const relativePath = url.slice(5); // fjern "file:"
    return "file:" + path.resolve(process.cwd(), relativePath);
  }
  return url;
}

function createPrismaClient() {
  const dbUrl = resolveDbUrl(process.env.DATABASE_URL || "file:prisma/dev.db");
  const adapter = new PrismaLibSql({ url: dbUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
