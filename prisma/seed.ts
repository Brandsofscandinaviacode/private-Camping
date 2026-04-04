import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";
import path from "path";

function resolveDbUrl(url: string): string {
  if (url.startsWith("file:") && !url.startsWith("file:/")) {
    return "file:" + path.resolve(process.cwd(), url.slice(5));
  }
  return url;
}

const adapter = new PrismaLibSql({ url: resolveDbUrl(process.env.DATABASE_URL!) });
const prisma = new PrismaClient({ adapter });

async function main() {
  const defaults = [
    { key: "price_per_kwh", value: "2.50" },
    { key: "price_per_liter_water", value: "0.05" },
    { key: "currency", value: "DKK" },
    { key: "ha_url", value: "http://homeassistant.local:8123" },
    { key: "ha_token", value: "" },
    { key: "default_occupied_temp", value: "21" },
    { key: "default_vacant_temp", value: "15" },
  ];

  for (const setting of defaults) {
    await prisma.globalSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!existingAdmin) {
    const hash = await bcrypt.hash("admin123", 10);
    await prisma.user.create({
      data: { username: "admin", passwordHash: hash },
    });
    console.log("Standard admin-bruger oprettet (admin / admin123)");
    console.log("VIGTIGT: Skift adgangskode efter første login!");
  }

  console.log("Seed fuldført.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
