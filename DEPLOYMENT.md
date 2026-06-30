# CampSense — Deployment Guide

Hetzner VPS + Coolify + CampSense (with built-in Mosquitto MQTT broker).

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

Point your domain at the server IP:

| Record | Name | Value |
|--------|------|-------|
| A | `campsense.example.com` | `<server-ip>` |

Replace `example.com` with your actual domain.

### 1.3 Firewall

Open the required ports (Hetzner Console → Firewalls, or `ufw` on the server):

| Port | Purpose |
|------|---------|
| 22 | SSH |
| 80 | HTTP (Let's Encrypt + redirect) |
| 443 | HTTPS (app) |
| 8000 | Coolify dashboard |
| 1883 | MQTT (Shelly devices) |

```bash
ssh root@<server-ip>
apt update && apt upgrade -y
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 8000/tcp && ufw allow 1883/tcp && ufw enable
```

---

## Part 2: Install Coolify

### 2.1 Run the installer

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Takes 2-5 minutes.

### 2.2 First-time setup

1. Open `http://<server-ip>:8000`
2. Create your admin account
3. Choose **Localhost** as your server
4. Coolify validates Docker — click **Continue**

### 2.3 Connect your GitHub repo

1. **Sources** → **Add** → **GitHub App**
2. Install the Coolify GitHub App on your organization
3. Grant access to the `private-Camping` repository

---

## Part 3: The MQTT Broker

The MQTT broker (Mosquitto) is included in the same `docker-compose.yaml` as the
app, so Coolify manages both as one resource. **There is no host setup and no
SSH** — the broker configures itself on startup from two environment variables
you set in the Coolify UI (next part, step 4.2):

| Variable | Purpose |
|----------|---------|
| `MQTT_USERNAME` | Broker login (optional, defaults to `campsense`) |
| `MQTT_PASSWORD` | Broker password — **required**, pick a strong one and save it |

On every start the broker writes its own config and password file from these,
then launches. Nothing to mount, nothing to renew.

---

## Part 4: Deploy CampSense on Coolify

### 4.1 Create the resource

1. In Coolify → **Projects** → **Add** → name it `CampSense`
2. Click into the project → **New Resource**
3. Choose **Docker Compose**
4. Select **GitHub** as source → pick the `private-Camping` repo
5. **Branch**: `claude/camping-utility-dashboard-JB9a9` (or `main` after merging)
6. Coolify detects `docker-compose.yaml` — confirm

### 4.2 Set environment variables

In the resource settings → **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `SESSION_SECRET` | *(generate with `openssl rand -base64 32`)* |
| `MQTT_PASSWORD` | *(a strong password for the broker — save it)* |
| `MQTT_USERNAME` | `campsense` *(optional; this is the default)* |

### 4.3 Configure the domain

1. Resource settings → **app** service → **Domains**
2. Enter `https://campsense.example.com`
3. Coolify auto-provisions a Let's Encrypt certificate

### 4.4 Deploy

Click **Deploy**. First build takes 3-5 minutes. When the health check passes,
both the app and the MQTT broker are running.

---

## Part 5: Post-Deploy Configuration

### 5.1 First login

1. Open `https://campsense.example.com`
2. Log in with **admin** / **admin123**
3. **Change the password immediately** in Settings

### 5.2 Configure MQTT

Go to **Indstillinger → MQTT**:

1. **Aktivér MQTT broker**: check
2. **Host**: `mosquitto` (this is the Docker internal hostname)
3. **Port**: `1883`
4. **TLS / SSL**: leave unchecked (traffic stays inside Docker's network)
5. **Brugernavn**: `campsense` (or your `MQTT_USERNAME`)
6. **Adgangskode**: your `MQTT_PASSWORD` from step 4.2
7. Click **Test forbindelse** — should show green
8. Click **Gem og genstart klient**

### 5.3 Set up the API key

Go to **Indstillinger → System**:

1. Generate an API key (e.g. `openssl rand -hex 32`)
2. Save it — you need this for the cron job

### 5.4 Set up the cron job

The cron job hits `/api/cron` every 2 minutes (showers, laundry, electricity, prepaid, invoices).

**Option A — Coolify Scheduled Task** (recommended):

1. In Coolify → your resource → **Scheduled Tasks**
2. Add a new task:
   - **Name**: `cron`
   - **Schedule**: `*/2 * * * *`
   - **Container**: `app`
   - **Command**: `curl -fsS -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/api/cron`

**Option B — System crontab**:

```bash
crontab -e
# Add:
*/2 * * * * curl -fsS -H "Authorization: Bearer YOUR_API_KEY" https://campsense.example.com/api/cron > /dev/null 2>&1
```

### 5.5 Connect Shelly devices

For each Shelly device:

1. Open the Shelly web UI → **Settings → MQTT**
2. Enable MQTT
3. Set **Server** to `<server-ip>:1883` (your Hetzner server's public IP)
4. Enter the Mosquitto username/password (`MQTT_USERNAME` / `MQTT_PASSWORD`)
5. Note the **MQTT Prefix** (e.g. `shellyplus1pm-abc123`)
6. Save and reboot

In CampSense, under each unit's hardware settings, select **MQTT (Shelly direkte)** and enter the prefix + component.

### 5.6 Configure Home Assistant (optional)

1. **Indstillinger → Home Assistant**
2. Enter the HA URL and a Long-Lived Access Token
3. Click **Test forbindelse**

---

## Part 6: Maintenance

### Updating the app

Push new code to the branch. In Coolify, click **Deploy** (or enable auto-deploy). The entrypoint re-runs `prisma db push` to apply schema changes. Mosquitto is unaffected (its image hasn't changed).

### Backups

```bash
docker volume inspect campsense-data | grep Mountpoint
cp /var/lib/docker/volumes/campsense-data/_data/campsense.db ~/backups/campsense-$(date +%Y%m%d).db
```

Automate with a daily cron:

```
0 3 * * * cp /var/lib/docker/volumes/campsense-data/_data/campsense.db /root/backups/campsense-$(date +\%Y\%m\%d).db
```

### Logs

```bash
# App logs (in Coolify UI or via SSH)
docker logs <app-container> --tail 100 -f

# Mosquitto logs
docker logs <mosquitto-container> --tail 100 -f
```

---

## Optional: Add TLS for MQTT

If you want encrypted MQTT connections (e.g. Shelly devices connecting over the
public internet with TLS on port 8883), you can add TLS later:

1. Point a DNS record `mqtt.example.com` at your server.
2. Get a cert: `certbot certonly --standalone -d mqtt.example.com` (stop the
   Coolify proxy briefly so port 80 is free).
3. Mount the certs into the broker — add to the `mosquitto` service in
   `docker-compose.yaml`:
   ```yaml
       volumes:
         - mosquitto-data:/mosquitto/data
         - /etc/letsencrypt/live/mqtt.example.com:/mosquitto/certs:ro
   ```
4. Extend the broker's inline config (the `printf` line in the `command`) with a
   second TLS listener, so it ends with:
   ```
   ...listener 8883\ncertfile /mosquitto/certs/fullchain.pem\nkeyfile /mosquitto/certs/privkey.pem\n
   ```
   and publish the port: add `- "8883:8883"` under the broker's `ports`.
5. Open port 8883 in the firewall, then point your Shelly devices at
   `mqtt.example.com:8883` with TLS enabled.

For most camping sites, password-auth on port 1883 is sufficient.

---

## Quick Reference

| Service | URL / Port | Purpose |
|---------|-----------|---------|
| CampSense | `https://campsense.example.com` | The app |
| Coolify | `http://<server-ip>:8000` | Deployment dashboard |
| Mosquitto | `mqtt://mosquitto:1883` (internal) | MQTT broker |
| Shelly | `mqtt://<server-ip>:1883` (external) | Shelly device connection |
| Cron | `GET /api/cron` every 2 min | Background jobs |

| Default credentials | |
|--------------------|-|
| CampSense admin | `admin` / `admin123` (change immediately) |
| MQTT user | `campsense` / *(your chosen password)* |
