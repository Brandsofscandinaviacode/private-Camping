# CampSense — Deployment Guide

Complete step-by-step guide: Hetzner VPS + Coolify + Mosquitto (TLS) + CampSense.

---

## Part 1: Hetzner VPS

### 1.1 Create the server

1. Log in at [console.hetzner.cloud](https://console.hetzner.cloud)
2. Click **Add Server**
3. Choose:
   - **Location**: Falkenstein or Helsinki (cheapest)
   - **Image**: Ubuntu 24.04
   - **Type**: CX22 (2 vCPU, 4 GB RAM) — minimum for Coolify + the app
   - **Networking**: Public IPv4 + IPv6
   - **SSH Key**: Add your public key (or create one with `ssh-keygen -t ed25519`)
4. Name it (e.g. `campsense`) and click **Create & Buy Now**
5. Note the IP address

### 1.2 DNS

Point your domains at the server IP. You need two A-records:

| Record | Name | Value |
|--------|------|-------|
| A | `campsense.example.com` | `<server-ip>` |
| A | `mqtt.example.com` | `<server-ip>` |

Replace `example.com` with your actual domain. Wait for DNS to propagate (a few minutes to hours).

### 1.3 SSH in and prepare

```bash
ssh root@<server-ip>
```

Update the system:

```bash
apt update && apt upgrade -y
```

Open the required firewall ports (if you enabled the Hetzner firewall):

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Let's Encrypt + redirect) |
| 443 | TCP | HTTPS (app) |
| 8000 | TCP | Coolify dashboard |
| 8883 | TCP | MQTT over TLS |

In Hetzner Console → Firewalls, or with `ufw`:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp
ufw allow 8883/tcp
ufw enable
```

---

## Part 2: Install Coolify

### 2.1 Run the installer

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This installs Docker, Docker Compose, and Coolify. Takes 2-5 minutes.

### 2.2 First-time setup

1. Open `http://<server-ip>:8000` in your browser
2. Create your admin account (email + password)
3. On the welcome screen, choose **Localhost** as your server (Coolify manages the same machine it runs on)
4. Coolify will validate the Docker connection — click **Continue**

### 2.3 Connect your GitHub repo

1. Go to **Sources** → **Add** → **GitHub App**
2. Follow the wizard to install the Coolify GitHub App on your `brandsofscandinaviacode` organization
3. Grant it access to the `private-Camping` repository

---

## Part 3: Mosquitto MQTT Broker inside Coolify (with TLS)

The broker runs as a **second Coolify resource**, next to the app. TLS terminates
at Mosquitto on port 8883 using a Let's Encrypt certificate. Because MQTT is a raw
TCP service (not HTTP), Coolify's Traefik can't auto-provision the cert — so we
obtain it once with the host's `certbot` and a renewal hook keeps it fresh.

Reference files live in the repo under **`deploy/mosquitto/`**.

### 3.1 Get the TLS certificate (one-time, on the host)

SSH into the server and install certbot:

```bash
apt install -y certbot
```

Request a certificate for your MQTT domain. Coolify's proxy owns port 80, so stop
it for the ~30 seconds the challenge needs, then start it again:

```bash
docker stop coolify-proxy
certbot certonly --standalone -d mqtt.example.com --agree-tos -m you@example.com --non-interactive
docker start coolify-proxy
```

> **Zero-downtime alternative**: if your DNS provider has a certbot plugin
> (e.g. Cloudflare), use a DNS-01 challenge instead and skip the proxy stop:
> `certbot certonly --dns-cloudflare -d mqtt.example.com`.

### 3.2 Prepare the host directories

The `eclipse-mosquitto` container runs as UID **1883**, so the config, password,
and certificate files must be readable by that user.

```bash
mkdir -p /opt/mosquitto/config /opt/mosquitto/certs
```

Create the broker config (copy of `deploy/mosquitto/mosquitto.conf`):

```bash
cat > /opt/mosquitto/config/mosquitto.conf << 'EOF'
allow_anonymous false
password_file /mosquitto/config/passwd

listener 8883
certfile /mosquitto/certs/fullchain.pem
keyfile /mosquitto/certs/privkey.pem
tls_version tlsv1.2

persistence true
persistence_location /mosquitto/data/

log_dest stdout
log_type warning
log_type error
log_type notice
EOF
```

### 3.3 Create the broker user

Use the Mosquitto image itself to create the password file (no need to install
anything on the host):

```bash
docker run --rm -it -v /opt/mosquitto/config:/mosquitto/config \
  eclipse-mosquitto:2 \
  mosquitto_passwd -c /mosquitto/config/passwd campsense
```

Enter a strong password when prompted. **Save it** — you'll need it in the
CampSense admin panel.

### 3.4 Install the certificate renewal hook

This copies the cert where the container can read it (and restarts the broker on
every renewal):

```bash
cat > /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh << 'HOOK'
#!/bin/bash
cp /etc/letsencrypt/live/mqtt.example.com/fullchain.pem /opt/mosquitto/certs/
cp /etc/letsencrypt/live/mqtt.example.com/privkey.pem   /opt/mosquitto/certs/
chown -R 1883:1883 /opt/mosquitto/certs /opt/mosquitto/config
chmod 600 /opt/mosquitto/certs/privkey.pem
docker restart $(docker ps -q -f name=mosquitto) 2>/dev/null || true
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh
```

Run it once now to place the initial certs and fix ownership:

```bash
bash /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh
```

(The `docker restart` line is a no-op until the container exists — that's fine.)

### 3.5 Create the Coolify resource

1. In Coolify → your project → **New Resource** → **Docker Compose** → **Empty**
2. Paste the contents of `deploy/mosquitto/docker-compose.yml`:

   ```yaml
   services:
     mosquitto:
       image: eclipse-mosquitto:2
       restart: unless-stopped
       ports:
         - "8883:8883"
       volumes:
         - /opt/mosquitto/config:/mosquitto/config:ro
         - /opt/mosquitto/certs:/mosquitto/certs:ro
         - mosquitto-data:/mosquitto/data
   volumes:
     mosquitto-data:
   ```
3. **Deploy.**

> No domain is set on this resource — it's not an HTTP service. The `ports`
> mapping publishes 8883 directly to the host, bypassing Traefik (correct for
> raw MQTT). Make sure port **8883/tcp** is open in your Hetzner firewall.

### 3.6 Verify it's listening

On the host:

```bash
ss -tlnp | grep 8883        # should show the port bound
docker logs $(docker ps -q -f name=mosquitto) --tail 20
```

You should see `mosquitto version 2.x running` with no certificate errors.

---

## Part 4: Deploy CampSense on Coolify

### 4.1 Create the resource

1. In Coolify dashboard → **Projects** → **Add** → name it `CampSense`
2. Click into the project → **New Resource**
3. Choose **Docker Compose**
4. Select **GitHub** as source → pick the `private-Camping` repo
5. **Branch**: `claude/camping-utility-dashboard-JB9a9` (or `main` after merging)
6. Coolify detects `docker-compose.yaml` — confirm

### 4.2 Set environment variables

In the resource settings → **Environment Variables**, add:

| Key | Value | Notes |
|-----|-------|-------|
| `SESSION_SECRET` | *(generate one, see below)* | Required for cookie encryption |

Generate the secret on your server:

```bash
openssl rand -base64 32
```

Paste the output as the value. The other variables (`DATABASE_URL`, `FORCE_HTTPS`) are already defined in the compose file.

### 4.3 Configure the domain

1. In the resource settings → **app** service → **Domains**
2. Enter `https://campsense.example.com`
3. Coolify configures Traefik and provisions a Let's Encrypt HTTPS certificate automatically

### 4.4 Persistent storage

Verify the volume is mapped. Coolify should detect the `campsense-data` volume from the compose file. This stores the SQLite database. The entrypoint runs `prisma db push` + seed on each container start, so the schema is always up to date.

### 4.5 Deploy

Click **Deploy**. Watch the build logs. First build takes 3-5 minutes (npm install + Next.js build). Subsequent builds are faster thanks to Docker layer caching.

When the build finishes and the health check passes, the app is live.

---

## Part 5: Post-Deploy Configuration

### 5.1 First login

1. Open `https://campsense.example.com`
2. Log in with **admin** / **admin123**
3. **Change the password immediately** in Indstillinger (Settings) → Admin

### 5.2 Configure MQTT

Go to **Indstillinger → MQTT**:

1. **Aktivér MQTT broker**: check
2. **Host**: `mqtt.example.com` (your MQTT domain)
3. **Port**: `8883`
4. **TLS / SSL**: check (the port auto-switches to 8883)
5. **Brugernavn**: `campsense`
6. **Adgangskode**: the password from step 3.3
7. Click **Test forbindelse** — should show green "Forbundet til mqtt.example.com:8883"
8. Click **Gem og genstart klient**

> **Why the public domain and not an internal name?** The TLS certificate is
> issued for `mqtt.example.com`, so the app (which verifies the cert) must
> connect using that exact hostname. The same hostname is what your Shelly
> devices use, so everything is consistent.
>
> **If "Test forbindelse" fails from inside Coolify** but works from your
> laptop, your host may not allow hairpin NAT (a container reaching the
> server's own public IP). Fix it by adding an `extra_hosts` entry to the
> **app** service in `docker-compose.yaml` so the domain resolves to the
> Docker gateway:
> ```yaml
>     extra_hosts:
>       - "mqtt.example.com:host-gateway"
> ```
> Redeploy the app after adding it.

### 5.3 Set up the API key

Go to **Indstillinger → System**:

1. Generate an API key (any long random string, e.g. `openssl rand -hex 32`)
2. Save it — you need this for the cron job

### 5.4 Set up the cron job

The cron job hits `/api/cron` every 2 minutes. It handles:
- Shower/laundry session expiry
- Metered laundry power monitoring (stop when watts < threshold)
- Electricity/water consumption ticks (spot price integration)
- Prepaid balance monitoring (auto power-off when depleted)
- Invoice generation and overdue checks

**Option A — Coolify Scheduled Task** (recommended):

1. In Coolify → your resource → **Scheduled Tasks**
2. Add a new task:
   - **Name**: `cron`
   - **Schedule**: `*/2 * * * *`
   - **Container**: `app`
   - **Command**:
     ```
     curl -fsS -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/api/cron
     ```

**Option B — System crontab** (if Coolify doesn't support scheduled tasks in your version):

```bash
crontab -e
```

Add:

```
*/2 * * * * curl -fsS -H "Authorization: Bearer YOUR_API_KEY" https://campsense.example.com/api/cron > /dev/null 2>&1
```

### 5.5 Configure Home Assistant (optional)

If you also use Home Assistant for climate/locks:

1. Go to **Indstillinger → Home Assistant**
2. Enter the HA URL (e.g. `https://ha.example.com`)
3. Enter a Long-Lived Access Token (create in HA → Profile → Security → Long-Lived Access Tokens)
4. Click **Test forbindelse**

### 5.6 Connect Shelly devices

For each Shelly Gen3+ device on your campsite:

1. Open the Shelly's web UI (or Shelly Smart app)
2. Go to **Settings → Connectivity → MQTT**
3. Enable MQTT
4. Set **Server** to `mqtt.example.com:8883`
5. Check **Enable TLS** (Shelly Gen3 supports this)
6. Enter the Mosquitto username/password
7. Note the **MQTT Prefix** (e.g. `shellyplus1pm-abc123`)
8. Save and reboot the device

Then in CampSense, under each unit's hardware settings, select **MQTT (Shelly direkte)** and enter the prefix + component (e.g. `switch:0`).

---

## Part 6: Maintenance

### Updating the app

Push new code to the branch. In Coolify, click **Deploy** (or enable auto-deploy on push). The entrypoint re-runs `prisma db push` to apply any schema changes.

### Backups

The SQLite database lives in the `campsense-data` Docker volume. Back it up:

```bash
# Find the volume path
docker volume inspect campsense-data | grep Mountpoint

# Copy the database file
cp /var/lib/docker/volumes/campsense-data/_data/campsense.db ~/backups/campsense-$(date +%Y%m%d).db
```

Automate with a daily cron:

```bash
crontab -e
```

```
0 3 * * * cp /var/lib/docker/volumes/campsense-data/_data/campsense.db /root/backups/campsense-$(date +\%Y\%m\%d).db
```

### Certificate renewal

Let's Encrypt certs auto-renew via the systemd timer installed by certbot. The deploy hook (step 3.4) copies fresh certs into `/opt/mosquitto/certs` and restarts the Mosquitto container automatically.

Verify the timer is active:

```bash
systemctl status certbot.timer
```

### Logs

```bash
# App logs
docker logs <container-name> --tail 100 -f

# Mosquitto logs (it's a Coolify container now)
docker logs $(docker ps -q -f name=mosquitto) --tail 100 -f

# Cron results (check via the admin UI)
# Indstillinger → System shows last cron run time and status
```

---

## Quick Reference

| Service | URL / Port | Purpose |
|---------|-----------|---------|
| CampSense | `https://campsense.example.com` | The app |
| Coolify | `http://<server-ip>:8000` | Deployment dashboard |
| Mosquitto | `mqtts://mqtt.example.com:8883` | MQTT broker (TLS) |
| Cron | `GET /api/cron` every 2 min | Background jobs |

| Default credentials | |
|--------------------|-|
| CampSense admin | `admin` / `admin123` (change immediately) |
| MQTT user | `campsense` / *(your chosen password)* |
