-- AlterTable: Add heating relay and winter mode fields
ALTER TABLE "unit_hardware" ADD COLUMN "hasHeating" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "unit_hardware" ADD COLUMN "heatingSwitchEntityId" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "heatingMeterEntityId" TEXT;
ALTER TABLE "unit_hardware" ADD COLUMN "winterModeEnabled" BOOLEAN NOT NULL DEFAULT false;
