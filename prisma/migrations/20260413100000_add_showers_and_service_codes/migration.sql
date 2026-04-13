-- Add code / location / kind to laundry machines
ALTER TABLE "laundry_machines" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WASHER';
ALTER TABLE "laundry_machines" ADD COLUMN "code" TEXT;
ALTER TABLE "laundry_machines" ADD COLUMN "location" TEXT;
CREATE UNIQUE INDEX "laundry_machines_code_key" ON "laundry_machines"("code");

-- Showers
CREATE TABLE "showers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "switchEntityId" TEXT NOT NULL,
    "pricePerMinute" REAL NOT NULL DEFAULT 2,
    "minMinutes" INTEGER NOT NULL DEFAULT 2,
    "maxMinutes" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "location" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "showers_code_key" ON "showers"("code");

-- Shower sessions
CREATE TABLE "shower_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showerId" INTEGER NOT NULL,
    "sessionId" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pausedAt" DATETIME,
    "pauseRemainingMs" INTEGER,
    "pauseResumedAt" DATETIME,
    "pricePaid" REAL NOT NULL DEFAULT 0,
    "minutesPaid" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paymentId" TEXT,
    "pendingMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "shower_sessions_showerId_fkey" FOREIGN KEY ("showerId") REFERENCES "showers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shower_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "shower_sessions_showerId_status_idx" ON "shower_sessions"("showerId", "status");
CREATE INDEX "shower_sessions_status_endsAt_idx" ON "shower_sessions"("status", "endsAt");
