-- AlterTable: optional instantaneous power (W) entity IDs
ALTER TABLE "unit_hardware" ADD COLUMN "electricityPowerEntityId" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "heatingPowerEntityId" TEXT;
