-- Snapshot of what the booking system last sent per field, so the sync can
-- tell a desk correction from a booking-system change.
ALTER TABLE "sessions" ADD COLUMN "lastSyncedValues" TEXT;

-- Link existing imports by their stable key. Duplicate refs: an ACTIVE stay
-- wins over PENDING over COMPLETED, cancelled last, oldest first.
-- (syncBookings repeats this backfill for databases updated with db push.)
UPDATE "sessions" SET "externalBookingId" = "bookingRef"
WHERE "externalBookingId" IS NULL
  AND "bookingRef" LIKE 'danplanner:%'
  AND NOT EXISTS (SELECT 1 FROM "sessions" s3 WHERE s3."externalBookingId" = "sessions"."bookingRef")
  AND "id" = (
    SELECT s2."id" FROM "sessions" s2
    WHERE s2."bookingRef" = "sessions"."bookingRef"
    ORDER BY
      CASE
        WHEN s2."cancelledAt" IS NOT NULL THEN 3
        WHEN s2."status" = 'ACTIVE' THEN 0
        WHEN s2."status" = 'PENDING' THEN 1
        ELSE 2
      END,
      s2."id"
    LIMIT 1
  );
