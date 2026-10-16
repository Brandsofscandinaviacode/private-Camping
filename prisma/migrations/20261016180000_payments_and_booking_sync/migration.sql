-- Booking-system link and desk-edit protection on sessions, reservation
-- cancellation, and a payments ledger for the desk till.
ALTER TABLE "sessions" ADD COLUMN "externalBookingId" TEXT;
ALTER TABLE "sessions" ADD COLUMN "lockedFields" TEXT;
ALTER TABLE "sessions" ADD COLUMN "syncConflicts" TEXT;
ALTER TABLE "sessions" ADD COLUMN "missingFromFeedAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "cancelReason" TEXT;
CREATE UNIQUE INDEX "sessions_externalBookingId_key" ON "sessions"("externalBookingId");

CREATE TABLE "payments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER,
    "invoiceId" INTEGER,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "reversesId" INTEGER,
    "externalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payments_reversesId_key" ON "payments"("reversesId");
CREATE INDEX "payments_sessionId_idx" ON "payments"("sessionId");
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");
