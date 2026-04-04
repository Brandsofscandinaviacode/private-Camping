import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! });
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

  console.log("Seed complete: default global settings created.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
