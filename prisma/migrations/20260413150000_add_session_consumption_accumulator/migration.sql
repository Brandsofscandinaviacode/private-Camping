-- Time-weighted billing accumulators. Each tick (cron every 10 min) adds
-- `delta_kwh × current_spot_price` to accumulatedElCost so the guest is
-- billed against the actual spot price in the hour the consumption happened.
ALTER TABLE "sessions" ADD COLUMN "accumulatedElCost" REAL NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "accumulatedElKwh" REAL NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "accumulatedWaterCost" REAL NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "accumulatedWaterLiters" REAL NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "lastTickKwh" REAL;
ALTER TABLE "sessions" ADD COLUMN "lastTickHeatingKwh" REAL;
ALTER TABLE "sessions" ADD COLUMN "lastTickWaterLiters" REAL;
ALTER TABLE "sessions" ADD COLUMN "lastTickAt" DATETIME;
