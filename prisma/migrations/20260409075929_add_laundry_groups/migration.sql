-- CreateTable
CREATE TABLE "laundry_groups" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_laundry_machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "switchEntityId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "pricePerUse" REAL NOT NULL DEFAULT 25,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "groupId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "laundry_machines_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "laundry_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_laundry_machines" ("createdAt", "durationMinutes", "enabled", "id", "name", "pricePerUse", "switchEntityId", "updatedAt") SELECT "createdAt", "durationMinutes", "enabled", "id", "name", "pricePerUse", "switchEntityId", "updatedAt" FROM "laundry_machines";
DROP TABLE "laundry_machines";
ALTER TABLE "new_laundry_machines" RENAME TO "laundry_machines";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "laundry_groups_token_key" ON "laundry_groups"("token");
