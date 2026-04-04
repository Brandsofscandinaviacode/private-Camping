-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "bookingRef" TEXT,
    "guestPortalToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "paidAt" DATETIME,
    "checkInTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutTime" DATETIME,
    "startKwh" REAL,
    "startWaterLiters" REAL,
    "endKwh" REAL,
    "endWaterLiters" REAL,
    "totalElectricityCost" REAL,
    "totalWaterCost" REAL,
    "totalCost" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sessions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_sessions" ("checkInTime", "checkOutTime", "createdAt", "endKwh", "endWaterLiters", "guestName", "guestPortalToken", "id", "startKwh", "startWaterLiters", "status", "totalCost", "totalElectricityCost", "totalWaterCost", "unitId", "updatedAt") SELECT "checkInTime", "checkOutTime", "createdAt", "endKwh", "endWaterLiters", "guestName", "guestPortalToken", "id", "startKwh", "startWaterLiters", "status", "totalCost", "totalElectricityCost", "totalWaterCost", "unitId", "updatedAt" FROM "sessions";
DROP TABLE "sessions";
ALTER TABLE "new_sessions" RENAME TO "sessions";
CREATE UNIQUE INDEX "sessions_guestPortalToken_key" ON "sessions"("guestPortalToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
