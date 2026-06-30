#!/bin/bash
set -e

# Bare-metal / systemd deploy (legacy path — the supported path is now
# Docker + Coolify, see DEPLOYMENT.md).
#
# This no longer uses Next.js "standalone" output. The systemd unit must run
# the normal production server, i.e.:
#
#   [Service]
#   WorkingDirectory=/opt/campsense/app
#   ExecStart=/usr/bin/npm start          # -> next start
#   EnvironmentFile=/opt/campsense/app/.env
#
# (Previously this was `node .next/standalone/server.js`; update it once.)

echo "=== CampSense Deploy ==="

cd /opt/campsense/app

echo "[1/6] Pulling latest code..."
git config --global --add safe.directory /opt/campsense/app 2>/dev/null || true
sudo -u campsense git pull origin claude/camping-utility-dashboard-JB9a9

echo "[2/6] Installing dependencies..."
sudo -u campsense npm ci

echo "[3/6] Generating Prisma client..."
sudo -u campsense npx prisma generate

echo "[4/6] Running database migrations..."
sudo -u campsense npx prisma migrate deploy

echo "[5/6] Building..."
sudo -u campsense npm run build

echo "[6/6] Restarting service..."
systemctl restart campsense

sleep 2
echo ""
echo "=== Deploy complete ==="
systemctl status campsense --no-pager
