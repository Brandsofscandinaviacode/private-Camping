-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "bookingRef" TEXT,
    "guestPortalToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "paidAt" DATETIME,
    "checkInTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutTime" DATETIME,
    "expectedCheckOut" DATETIME,
    "billingMode" TEXT NOT NULL DEFAULT 'POSTPAID',
    "prepaidAmount" REAL,
    "startKwh" REAL,
    "startWaterLiters" REAL,
    "endKwh" REAL,
    "endWaterLiters" REAL,
    "totalElectricityCost" REAL,
    "totalWaterCost" REAL,
    "totalCost" REAL,
    "externalPrice" REAL,
    "externalDescription" TEXT,
    "laundryCredit" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sessions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_sessions" ("billingMode", "bookingRef", "checkInTime", "checkOutTime", "createdAt", "endKwh", "endWaterLiters", "expectedCheckOut", "externalDescription", "externalPrice", "guestEmail", "guestName", "guestPhone", "guestPortalToken", "id", "notes", "paidAt", "paymentId", "paymentStatus", "prepaidAmount", "startKwh", "startWaterLiters", "status", "totalCost", "totalElectricityCost", "totalWaterCost", "unitId", "updatedAt") SELECT "billingMode", "bookingRef", "checkInTime", "checkOutTime", "createdAt", "endKwh", "endWaterLiters", "expectedCheckOut", "externalDescription", "externalPrice", "guestEmail", "guestName", "guestPhone", "guestPortalToken", "id", "notes", "paidAt", "paymentId", "paymentStatus", "prepaidAmount", "startKwh", "startWaterLiters", "status", "totalCost", "totalElectricityCost", "totalWaterCost", "unitId", "updatedAt" FROM "sessions";
DROP TABLE "sessions";
ALTER TABLE "new_sessions" RENAME TO "sessions";
CREATE UNIQUE INDEX "sessions_guestPortalToken_key" ON "sessions"("guestPortalToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
