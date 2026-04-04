-- CreateTable
CREATE TABLE "global_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "cabins" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VACANT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "cabin_hardware" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cabinId" INTEGER NOT NULL,
    "hasElectricity" BOOLEAN NOT NULL DEFAULT false,
    "electricitySwitchEntityId" TEXT,
    "electricityMeterEntityId" TEXT,
    "hasWater" BOOLEAN NOT NULL DEFAULT false,
    "waterMeterEntityId" TEXT,
    "hasClimate" BOOLEAN NOT NULL DEFAULT false,
    "climateEntityId" TEXT,
    "hasSmartLock" BOOLEAN NOT NULL DEFAULT false,
    "lockEntityId" TEXT,
    CONSTRAINT "cabin_hardware_cabinId_fkey" FOREIGN KEY ("cabinId") REFERENCES "cabins" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cabinId" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestPortalToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "checkInTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutTime" DATETIME,
    "startKwh" REAL,
    "startWaterLiters" REAL,
    "endKwh" REAL,
    "endWaterLiters" REAL,
    "totalElectricityCost" REAL,
    "totalWaterCost" REAL,
    "totalCost" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sessions_cabinId_fkey" FOREIGN KEY ("cabinId") REFERENCES "cabins" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "global_settings_key_key" ON "global_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "cabins_name_key" ON "cabins"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cabin_hardware_cabinId_key" ON "cabin_hardware"("cabinId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_guestPortalToken_key" ON "sessions"("guestPortalToken");
