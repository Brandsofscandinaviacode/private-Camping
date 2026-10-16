-- Desk corrections: when check-in/check-out was actually done (undo windows),
-- monthly interim invoicing per stay, invoices tied to the stay they bill
-- (so a stay that changes unit keeps them), and when an invoice was sent.
ALTER TABLE "sessions" ADD COLUMN "checkInRecordedAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "checkOutRecordedAt" DATETIME;
ALTER TABLE "sessions" ADD COLUMN "monthlyInvoicing" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "invoices" ADD COLUMN "sessionId" INTEGER REFERENCES "sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD COLUMN "sentAt" DATETIME;
CREATE INDEX "invoices_sessionId_idx" ON "invoices"("sessionId");
