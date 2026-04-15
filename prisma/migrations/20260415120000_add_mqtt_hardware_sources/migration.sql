-- Add MQTT transport as an alternative to Home Assistant for Shelly Gen3+ devices.
-- Per-feature `*Source` column picks "HA" (default) or "MQTT"; new mqtt* fields
-- hold the Shelly topic prefix + component (e.g. "shellyplus1pm-abc" + "switch:0").

-- Unit hardware: electricity
ALTER TABLE "unit_hardware" ADD COLUMN "electricitySource" TEXT NOT NULL DEFAULT 'HA';
ALTER TABLE "unit_hardware" ADD COLUMN "electricityMqttPrefix" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "electricityMqttComponent" TEXT;

-- Unit hardware: heating
ALTER TABLE "unit_hardware" ADD COLUMN "heatingSource" TEXT NOT NULL DEFAULT 'HA';
ALTER TABLE "unit_hardware" ADD COLUMN "heatingMqttPrefix" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "heatingMqttComponent" TEXT;

-- Unit hardware: water
ALTER TABLE "unit_hardware" ADD COLUMN "waterSource" TEXT NOT NULL DEFAULT 'HA';
ALTER TABLE "unit_hardware" ADD COLUMN "waterMqttPrefix" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "waterMqttComponent" TEXT;

-- Laundry machines: add source + MQTT fields, make switchEntityId nullable
-- (SQLite cannot alter NOT NULL constraints directly — rebuild the table)
ALTER TABLE "laundry_machines" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'HA';
ALTER TABLE "laundry_machines" ADD COLUMN "mqttPrefix" TEXT;
ALTER TABLE "laundry_machines" ADD COLUMN "mqttComponent" TEXT;

CREATE TABLE "new_laundry_machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WASHER',
    "source" TEXT NOT NULL DEFAULT 'HA',
    "switchEntityId" TEXT,
    "mqttPrefix" TEXT,
    "mqttComponent" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "pricePerUse" REAL NOT NULL DEFAULT 25,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "location" TEXT,
    "groupId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "laundry_machines_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "laundry_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_laundry_machines" ("id", "name", "kind", "source", "switchEntityId", "mqttPrefix", "mqttComponent", "durationMinutes", "pricePerUse", "enabled", "code", "location", "groupId", "createdAt", "updatedAt")
SELECT "id", "name", "kind", "source", "switchEntityId", "mqttPrefix", "mqttComponent", "durationMinutes", "pricePerUse", "enabled", "code", "location", "groupId", "createdAt", "updatedAt" FROM "laundry_machines";
DROP TABLE "laundry_machines";
ALTER TABLE "new_laundry_machines" RENAME TO "laundry_machines";
CREATE UNIQUE INDEX "laundry_machines_code_key" ON "laundry_machines"("code");

-- Showers: same treatment
ALTER TABLE "showers" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'HA';
ALTER TABLE "showers" ADD COLUMN "mqttPrefix" TEXT;
ALTER TABLE "showers" ADD COLUMN "mqttComponent" TEXT;

CREATE TABLE "new_showers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'HA',
    "switchEntityId" TEXT,
    "mqttPrefix" TEXT,
    "mqttComponent" TEXT,
    "pricePerMinute" REAL NOT NULL DEFAULT 2,
    "minMinutes" INTEGER NOT NULL DEFAULT 2,
    "maxMinutes" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "location" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_showers" ("id", "name", "source", "switchEntityId", "mqttPrefix", "mqttComponent", "pricePerMinute", "minMinutes", "maxMinutes", "enabled", "code", "location", "createdAt", "updatedAt")
SELECT "id", "name", "source", "switchEntityId", "mqttPrefix", "mqttComponent", "pricePerMinute", "minMinutes", "maxMinutes", "enabled", "code", "location", "createdAt", "updatedAt" FROM "showers";
DROP TABLE "showers";
ALTER TABLE "new_showers" RENAME TO "showers";
CREATE UNIQUE INDEX "showers_code_key" ON "showers"("code");
