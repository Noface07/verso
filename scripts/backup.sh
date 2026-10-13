#!/usr/bin/env bash
# Folio automated backup script (PostgreSQL + Restic files volume)
# Retains 30 days of backups per BUILD_PLAN.md §6 P14.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/folio}"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
CONTAINER_DB="${CONTAINER_DB:-server-db-1}"
DB_NAME="${DB_NAME:-reader}"
DB_USER="${DB_USER:-reader}"

mkdir -p "$BACKUP_DIR"

echo "=== [Folio Backup] Starting at $(date) ==="

# 1. PostgreSQL logical dump
SQL_DUMP_FILE="$BACKUP_DIR/folio_db_${TIMESTAMP}.sql.gz"
echo "-> Dumping PostgreSQL database '$DB_NAME' from container '$CONTAINER_DB'..."
docker exec "$CONTAINER_DB" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$SQL_DUMP_FILE"
echo "-> Saved database dump to $SQL_DUMP_FILE ($(du -h "$SQL_DUMP_FILE" | cut -f1))"

# 2. Local dump retention (delete dumps older than 30 days)
echo "-> Pruning local database dumps older than 30 days..."
find "$BACKUP_DIR" -name "folio_db_*.sql.gz" -type f -mtime +30 -delete

# 3. Off-site Restic backup (if configured)
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  echo "-> Initiating Restic off-site snapshot to $RESTIC_REPOSITORY..."
  export RESTIC_REPOSITORY
  export RESTIC_PASSWORD="${RESTIC_PASSWORD:-}"

  # Backup files volume and current SQL dump
  restic backup \
    --tag folio \
    --tag automated \
    "${FILES_DIR:-/data/files}" \
    "$SQL_DUMP_FILE"

  echo "-> Applying Restic 30-day retention policy..."
  restic forget --keep-daily 30 --keep-weekly 8 --prune

  echo "-> Checking Restic repository integrity..."
  restic check --read-data-subset=10%
else
  echo "-> RESTIC_REPOSITORY not set; skipping off-site snapshot."
fi

echo "=== [Folio Backup] Finished successfully at $(date) ==="
