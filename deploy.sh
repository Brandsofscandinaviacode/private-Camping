#!/bin/bash
set -e

echo "=== CampSense Deploy ==="

cd /opt/campsense/app

echo "[1/7] Pulling latest code..."
git config --global --add safe.directory /opt/campsense/app 2>/dev/null || true
sudo -u campsense git pull origin claude/camping-utility-dashboard-JB9a9

echo "[2/7] Installing dependencies..."
sudo -u campsense npm ci

echo "[3/7] Generating Prisma client..."
sudo -u campsense npx prisma generate

echo "[4/7] Running database migrations..."
sudo -u campsense npx prisma migrate deploy

echo "[5/7] Building..."
sudo -u campsense npm run build

echo "[6/7] Copying static assets..."
sudo -u campsense cp -r .next/static .next/standalone/.next/static
sudo -u campsense cp -r public .next/standalone/public
sudo -u campsense mkdir -p .next/standalone/data
sudo -u campsense ln -sf /opt/campsense/app/data/campsense.db .next/standalone/data/campsense.db
if [ -d "data/uploads" ]; then
  sudo -u campsense mkdir -p .next/standalone/public/uploads
  sudo -u campsense cp -r data/uploads/* .next/standalone/public/uploads/ 2>/dev/null || true
fi

echo "[7/7] Restarting service..."
systemctl restart campsense

sleep 2
echo ""
echo "=== Deploy complete ==="
systemctl status campsense --no-pager
