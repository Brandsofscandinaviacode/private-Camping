#!/bin/bash
set -e

# ── CampSense Deploy Script ──
# Usage: sudo ./deploy.sh              # Deploy all sites
#        sudo ./deploy.sh aastrand     # Deploy only one site
#        sudo ./deploy.sh app          # Deploy main site

SITES_DIR="/opt/campsense"
BRANCH="claude/camping-utility-dashboard-JB9a9"
APP_USER="campsense"

deploy_site() {
  local site_dir="$1"
  local site_name="$(basename "$site_dir")"

  # Service name: 'app' = campsense, others = campsense-<name>
  local service="campsense"
  [ "$site_name" != "app" ] && service="campsense-${site_name}"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying: $site_name ($service)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$site_dir"

  echo "[1/7] Pulling latest code..."
  sudo -u "$APP_USER" git fetch origin "$BRANCH"
  sudo -u "$APP_USER" git checkout "$BRANCH" 2>/dev/null || true
  sudo -u "$APP_USER" git pull origin "$BRANCH"

  echo "[2/7] Installing dependencies..."
  sudo -u "$APP_USER" npm ci

  echo "[3/7] Generating Prisma client..."
  sudo -u "$APP_USER" npx prisma generate

  echo "[4/7] Running database migrations..."
  sudo -u "$APP_USER" npx prisma migrate deploy

  echo "[5/7] Building..."
  sudo -u "$APP_USER" npm run build

  echo "[6/7] Copying static assets..."
  sudo -u "$APP_USER" cp -r .next/static .next/standalone/.next/static
  sudo -u "$APP_USER" cp -r public .next/standalone/public
  sudo -u "$APP_USER" mkdir -p .next/standalone/public/uploads
  sudo -u "$APP_USER" mkdir -p .next/standalone/data
  sudo -u "$APP_USER" ln -sf "$site_dir/data/campsense.db" .next/standalone/data/campsense.db
  # Preserve uploaded files (site map etc.)
  if [ -d "public/uploads" ]; then
    sudo -u "$APP_USER" cp -r public/uploads/* .next/standalone/public/uploads/ 2>/dev/null || true
  fi
  if [ -d "data/uploads" ]; then
    sudo -u "$APP_USER" cp -r data/uploads/* .next/standalone/public/uploads/ 2>/dev/null || true
  fi

  echo "[7/7] Restarting $service..."
  systemctl restart "$service"

  sleep 2
  if systemctl is-active --quiet "$service"; then
    echo "  OK — $site_name is running"
  else
    echo "  FAILED — $site_name did not start:"
    journalctl -u "$service" --no-pager -n 10
    return 1
  fi
}

# ── Main ──
echo ""
echo "  CampSense Deploy"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Error: Run with sudo — e.g. sudo ./deploy.sh"
  exit 1
fi

# Find sites to deploy
if [ -n "$1" ]; then
  target="$SITES_DIR/$1"
  if [ ! -d "$target" ] || [ ! -f "$target/.env" ]; then
    echo "Error: Site '$1' not found in $SITES_DIR"
    exit 1
  fi
  DEPLOY_SITES=("$target")
else
  DEPLOY_SITES=()
  for dir in "$SITES_DIR"/*/; do
    [ -f "$dir/.env" ] && DEPLOY_SITES+=("${dir%/}")
  done
fi

if [ ${#DEPLOY_SITES[@]} -eq 0 ]; then
  echo "No sites found in $SITES_DIR"
  exit 1
fi

echo "Sites: $(for s in "${DEPLOY_SITES[@]}"; do basename "$s"; done | tr '\n' ' ')"

FAILED=0
for site_dir in "${DEPLOY_SITES[@]}"; do
  deploy_site "$site_dir" || FAILED=$((FAILED + 1))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
  echo "  Deploy complete — all sites running"
else
  echo "  Deploy finished with $FAILED failure(s)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
