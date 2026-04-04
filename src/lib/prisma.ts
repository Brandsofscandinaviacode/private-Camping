import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function resolveDbUrl(url: string): string {
  if (url.startsWith("file:") && !url.startsWith("file:/")) {
    const relativePath = url.slice(5);
    // Use join to build absolute path without dynamic path.resolve
    const cwd = /*turbopackIgnore: true*/ process.cwd();
    return "file:" + cwd + "/" + relativePath;
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
