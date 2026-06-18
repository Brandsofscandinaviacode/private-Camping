#!/bin/sh
set -e

echo "→ Applying database schema to $DATABASE_URL"
npx prisma db push --schema=./prisma/schema.prisma

echo "→ Seeding defaults (idempotent)"
npm run db:seed || echo "  seed skipped (continuing)"

exec "$@"
