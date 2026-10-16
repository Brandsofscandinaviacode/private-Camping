-- Laundry/shower: how each use was paid (desk, balance, account, credit, free),
-- who started it, and cancellation/refund details. Plus a ledger for the
-- service credit on a stay.
ALTER TABLE "laundry_sessions" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "laundry_sessions" ADD COLUMN "deskPaymentId" INTEGER;
ALTER TABLE "laundry_sessions" ADD COLUMN "creditUsed" REAL NOT NULL DEFAULT 0;
ALTER TABLE "laundry_sessions" ADD COLUMN "note" TEXT;
ALTER TABLE "laundry_sessions" ADD COLUMN "startedBy" TEXT;
ALTER TABLE "laundry_sessions" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "laundry_sessions" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "laundry_sessions" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "laundry_sessions" ADD COLUMN "refundAmount" REAL;
ALTER TABLE "laundry_sessions" ADD COLUMN "refundMethod" TEXT;

ALTER TABLE "shower_sessions" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "shower_sessions" ADD COLUMN "deskPaymentId" INTEGER;
ALTER TABLE "shower_sessions" ADD COLUMN "creditUsed" REAL NOT NULL DEFAULT 0;
ALTER TABLE "shower_sessions" ADD COLUMN "note" TEXT;
ALTER TABLE "shower_sessions" ADD COLUMN "startedBy" TEXT;
ALTER TABLE "shower_sessions" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "shower_sessions" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "shower_sessions" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "shower_sessions" ADD COLUMN "refundAmount" REAL;
ALTER TABLE "shower_sessions" ADD COLUMN "refundMethod" TEXT;

CREATE TABLE "service_credit_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "paymentId" INTEGER,
    "serviceRef" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "service_credit_entries_sessionId_idx" ON "service_credit_entries"("sessionId");
