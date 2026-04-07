-- Add billing mode + prepaid to sessions
ALTER TABLE "sessions" ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'POSTPAID';
ALTER TABLE "sessions" ADD COLUMN "prepaidAmount" REAL;

-- Laundry machines
CREATE TABLE "laundry_machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "switchEntityId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "pricePerUse" REAL NOT NULL DEFAULT 25,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Laundry sessions
CREATE TABLE "laundry_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "machineId" INTEGER NOT NULL,
    "sessionId" INTEGER,
    "guestPortalToken" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pricePaid" REAL NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "laundry_sessions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "laundry_machines" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "laundry_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
