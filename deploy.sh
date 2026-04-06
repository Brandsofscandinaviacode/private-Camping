#!/bin/bash
set -e

echo "=== CampSense Deploy ==="

cd "$(dirname "$0")"

echo "1/6 Pulling latest code..."
git pull

echo "2/6 Installing dependencies..."
npm install

echo "3/6 Running database migrations..."
npx prisma migrate deploy

echo "4/6 Generating Prisma client..."
npx prisma generate

echo "5/6 Building application..."
npm run build

# Copy static assets to standalone (required for output: "standalone")
echo "    Copying static assets to standalone..."
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# Ensure uploads directory exists in standalone
mkdir -p .next/standalone/public/uploads

# Preserve uploaded files (site map etc.)
if [ -d "public/uploads" ]; then
  cp -r public/uploads/* .next/standalone/public/uploads/ 2>/dev/null || true
fi

echo "6/6 Restarting service..."
sudo systemctl restart campsense

echo ""
echo "=== Deploy complete! ==="
echo "Status:"
sudo systemctl status campsense --no-pager
