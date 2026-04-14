-- Performance indices. Most query hot-paths (cron tick, admin dashboard,
-- charts, invoice lookups, alarm checks) were doing full table scans.
-- These indices cover the WHERE clauses used most frequently.

CREATE INDEX "sessions_status_idx" ON "sessions"("status");
CREATE INDEX "sessions_unitId_status_idx" ON "sessions"("unitId", "status");

CREATE INDEX "invoices_unitId_periodStart_idx" ON "invoices"("unitId", "periodStart");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

CREATE INDEX "consumption_logs_unitId_recordedAt_idx" ON "consumption_logs"("unitId", "recordedAt");
