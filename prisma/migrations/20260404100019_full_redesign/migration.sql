-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "global_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "units" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CABIN',
    "status" TEXT NOT NULL DEFAULT 'VACANT',
    "isLongTerm" BOOLEAN NOT NULL DEFAULT false,
    "longTermGuestName" TEXT,
    "longTermGuestEmail" TEXT,
    "longTermGuestPhone" TEXT,
    "longTermPortalToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "unit_hardware" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "hasElectricity" BOOLEAN NOT NULL DEFAULT false,
    "electricitySwitchEntityId" TEXT,
    "electricityMeterEntityId" TEXT,
    "hasWater" BOOLEAN NOT NULL DEFAULT false,
    "waterMeterEntityId" TEXT,
    "hasClimate" BOOLEAN NOT NULL DEFAULT false,
    "climateEntityId" TEXT,
    "hasSmartLock" BOOLEAN NOT NULL DEFAULT false,
    "lockEntityId" TEXT,
    CONSTRAINT "unit_hardware_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
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
    CONSTRAINT "sessions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "startKwh" REAL,
    "endKwh" REAL,
    "startWaterLiters" REAL,
    "endWaterLiters" REAL,
    "electricityCost" REAL NOT NULL DEFAULT 0,
    "waterCost" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidAt" DATETIME,
    "paymentId" TEXT,
    "paymentToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "invoices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "global_settings_key_key" ON "global_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "units_longTermPortalToken_key" ON "units"("longTermPortalToken");

-- CreateIndex
CREATE UNIQUE INDEX "unit_hardware_unitId_key" ON "unit_hardware"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_guestPortalToken_key" ON "sessions"("guestPortalToken");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentToken_key" ON "invoices"("paymentToken");
