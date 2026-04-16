-- Add access token to shower sessions for secure URL-based access.
-- Each session gets a unique CUID token so the active-session URL
-- becomes /shower/active/[sessionId]?token=xxx — preventing session
-- hijacking via predictable sequential IDs.

-- Step 1: Add the column (nullable initially for existing rows)
ALTER TABLE "shower_sessions" ADD COLUMN "accessToken" TEXT;

-- Step 2: Backfill existing rows with unique tokens based on id + random suffix
UPDATE "shower_sessions" SET "accessToken" = 'legacy_' || CAST("id" AS TEXT) || '_' || CAST(abs(random()) AS TEXT) WHERE "accessToken" IS NULL;

-- Step 3: Create the unique index
CREATE UNIQUE INDEX "shower_sessions_accessToken_key" ON "shower_sessions"("accessToken");
