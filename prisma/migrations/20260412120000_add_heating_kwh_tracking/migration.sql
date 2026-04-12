-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "startHeatingKwh" REAL;
ALTER TABLE "sessions" ADD COLUMN "endHeatingKwh" REAL;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "startHeatingKwh" REAL;
ALTER TABLE "invoices" ADD COLUMN "endHeatingKwh" REAL;

-- CreateTable — spot price cache (created here to catch up schema on production)
CREATE TABLE IF NOT EXISTS "spot_price_cache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "area" TEXT NOT NULL,
    "hourDK" TEXT NOT NULL,
    "priceDKK" REAL NOT NULL,
    "priceEUR" REAL NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "spot_price_cache_area_hourDK_key" ON "spot_price_cache"("area", "hourDK");
