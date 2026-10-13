# Folio Operations Manual

This document provides operational instructions for running the Folio server in production, performing backups, disaster recovery drills, and monitoring uptime.

---

## 1. Production Architecture Overview

The Folio server consists of three core containers orchestrated via Docker Compose:
- **`api`**: Fastify backend listening on port 8080.
- **`db`**: PostgreSQL 17 database storing synced tables and metadata.
- **`caddy`**: Reverse proxy with automatic Let's Encrypt TLS certificate generation on ports 80/443.
- **`duckdns`**: Dynamic DNS updater keeping `ffxasce.duckdns.org` synchronized with your router's public WAN IP.

---

## 2. Public Internet Deployment

### Step 1: Dynamic DNS (DuckDNS)
1. Sign in to [DuckDNS](https://www.duckdns.org) with your account.
2. Ensure domain `ffxasce.duckdns.org` is registered.
3. Note your DuckDNS Token.
4. Set in `.env`:
   ```env
   DOMAIN=ffxasce.duckdns.org
   DUCKDNS_SUBDOMAINS=ffxasce
   DUCKDNS_TOKEN=<your-token>
   ```

### Step 2: Router Port Forwarding & CGNAT Verification
1. Log in to your home router admin interface.
2. Verify that the **WAN IPv4 address** reported in your router status matches your public IP from `curl ifconfig.me`.
   - If they **differ** (e.g. WAN is `100.64.x.x` or `10.x.x.x`), your ISP uses **CGNAT**. Proceed to the **Cloudflare Tunnel Alternative** below.
3. If they match:
   - Forward TCP port **80** to your host server's local IP (port 80).
   - Forward TCP port **443** to your host server's local IP (port 443).

### Step 3: Cloudflare Tunnel Alternative (For CGNAT or Blocked Ports)
If port forwarding is impossible due to CGNAT:
1. Install `cloudflared` on the host:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create folio
   ```
2. In `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <Tunnel-UUID>
   credentials-file: /root/.cloudflared/<Tunnel-UUID>.json
   ingress:
     - hostname: ffxasce.duckdns.org
       service: http://localhost:8080
     - service: http_status:404
   ```
3. Run tunnel daemon: `cloudflared tunnel run folio`.

### Step 4: Starting the Stack
```bash
cd apps/server
cp .env.example .env
# Edit .env with secure random DB_PASSWORD and JWT_SECRET
docker compose up -d
```
Verify TLS issuance in logs:
```bash
docker compose logs -f caddy
```

The API applies database migrations on start (`MIGRATE_ON_START=true`); there is no
`init.sql` any more. To run them by hand: `pnpm --filter server db:migrate`.

### Step 4b: Using Supabase as the database (instead of the `db` container)
1. Create a project at [supabase.com](https://supabase.com) and note the database password.
2. In the dashboard, open **Connect** and copy the **Session pooler** URI (port **5432**):
   `postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   - Do **not** use the Transaction pooler (port 6543): live sync relies on
     `LISTEN/NOTIFY`, which doesn't work through it. The server warns if it sees 6543.
   - The direct connection (`db.<project-ref>.supabase.co`) also works but is IPv6-only
     unless you buy the IPv4 add-on.
3. Put it in `apps/server/.env` as `DATABASE_URL=...`. SSL is enabled automatically for
   Supabase hosts. For full certificate verification, download the CA from
   **Project Settings → Database → SSL Configuration** and set `DATABASE_CA_CERT` to its path.
4. Create the schema and verify everything (TLS, tables, RLS lockdown, live-sync NOTIFY):
   ```bash
   pnpm --filter server db:migrate
   pnpm --filter server db:check
   ```
5. Start the stack without the bundled Postgres:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d --build
   ```
   For local development against Supabase: `pnpm dev:server:supabase` from the repo root.

**Pool sizing:** the API keeps up to `DATABASE_POOL_MAX` (default 10) connections plus one
shared connection for live-sync notifications. Supabase's free tier allows 15 pooled
connections per pool, so leave headroom if anything else connects.

**Security:** migration `003_lock_down_public_api` enables Row Level Security on every table
and revokes the `anon`/`authenticated` roles, so Supabase's auto-generated REST API (whose
anon key is public) cannot read Folio's data. The API connects as the table owner and is
unaffected. Any new table added in a future migration should also
`enable row level security`. `db:check` reports any table that is exposed.

**Files** (book uploads) still live on the API host under `FILES_DIR`; only the database
moves to Supabase.

### Step 5: Account Creation & Hardening
1. Open Folio in browser (`https://ffxasce.duckdns.org`) or desktop app.
2. Navigate to **Settings → Account** and register your primary account.
3. Once registered, edit `apps/server/.env` to disable open signups:
   ```env
   ALLOW_SIGNUP=false
   ```
4. Restart the API:
   ```bash
   docker compose up -d api
   ```

---

## 3. Backups & Disaster Recovery

### Automated Nightly Backups
Backups are run via cron (`scripts/backup.sh`) or Windows Scheduled Task (`scripts/backup.ps1`):
1. **Logical database dump**: Nightly compressed `pg_dump` of PostgreSQL (`folio_db_YYYYMMDD_HHMMSS.sql.gz`).
2. **Local retention**: Automated purge of local dumps older than 30 days.
3. **Off-site Restic snapshot**: Encrypted snapshot of `/data/files` and SQL dump pushed to Backblaze B2 / S3 target with 30-day daily and 8-week weekly retention.

**Supabase:** there is no local db container, so set `BACKUP_DATABASE_URL` (the session
pooler or direct URI) and the backup scripts run `pg_dump` over the network instead. The
free tier has no point-in-time recovery, so keep these dumps.

### Monthly Restore Drill Procedure
To ensure backups are intact and recoverability is guaranteed, perform this drill monthly:

1. **Spin up an isolated test database container**:
   ```bash
   docker run -d --name folio-restore-test \
     -e POSTGRES_DB=reader \
     -e POSTGRES_USER=reader \
     -e POSTGRES_PASSWORD=testpass \
     postgres:17-alpine
   ```
2. **Restore the latest database dump**:
   ```bash
   gunzip -c /var/backups/folio/latest.sql.gz | docker exec -i folio-restore-test psql -U reader -d reader
   ```
3. **Verify record integrity**:
   ```bash
   docker exec -it folio-restore-test psql -U reader -d reader -c "SELECT count(*) FROM books; SELECT count(*) FROM annotations; SELECT count(*) FROM users;"
   ```
4. **Test Restic file retrieval**:
   ```bash
   restic restore latest --target /tmp/folio-restore-test-files --include "/data/files"
   ls -la /tmp/folio-restore-test-files
   ```
5. **Clean up drill resources**:
   ```bash
   docker rm -f folio-restore-test
   rm -rf /tmp/folio-restore-test-files
   ```

---

## 4. Monitoring & Healthchecks

### Uptime Kuma Setup
1. Configure an HTTP(s) Monitor:
   - **URL**: `https://ffxasce.duckdns.org/health`
   - **Method**: `GET`
   - **Interval**: 60 seconds
   - **Expected Status**: 200
   - **Expected Body**: `{"status":"ok"}`
2. Configure notification channels (Telegram, Discord, or Email) for instantaneous downtime alerts.

### Disk Space Alerts
1. Monitor host and Docker volumes:
   ```bash
   df -h /data/files
   ```
2. Set warning alert threshold at **80% disk capacity**.
3. Clear manga cache and unreferenced covers when needed:
   - In Folio app: **Settings → Storage → Clear Manga Cache**.
