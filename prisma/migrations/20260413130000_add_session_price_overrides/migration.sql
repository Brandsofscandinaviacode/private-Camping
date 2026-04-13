-- Per-booking price overrides. NULL means "use the global pricing_mode".
ALTER TABLE "sessions" ADD COLUMN "pricePerKwhOverride" REAL;
ALTER TABLE "sessions" ADD COLUMN "pricePerLiterWaterOverride" REAL;
