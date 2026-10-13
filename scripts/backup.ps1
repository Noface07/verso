# Folio Automated Backup Script for Windows
# Retains 30 days of database dumps and snapshots files

param (
    [string]$BackupDir = "D:\folio_backups",
    [string]$ContainerDb = "server-db-1",
    [string]$DbName = "reader",
    [string]$DbUser = "reader"
)

$ErrorActionPreference = "Stop"
$Timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

Write-Host "=== [Folio Backup] Starting at $(Get-Date) ==="

# 1. PostgreSQL logical dump
$SqlDumpPath = Join-Path $BackupDir "folio_db_$Timestamp.sql"
Write-Host "-> Dumping PostgreSQL database '$DbName' from container '$ContainerDb'..."
docker exec $ContainerDb pg_dump -U $DbUser $DbName > $SqlDumpPath

if (Test-Path $SqlDumpPath) {
    $Size = (Get-Item $SqlDumpPath).Length / 1MB
    Write-Host "-> Saved database dump to $SqlDumpPath ($([math]::Round($Size, 2)) MB)"
}

# 2. Local dump retention (delete dumps older than 30 days)
Write-Host "-> Pruning local database dumps older than 30 days..."
$Cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -Path $BackupDir -Filter "folio_db_*.sql" | Where-Object { $_.LastWriteTime -lt $Cutoff } | Remove-Item -Force

# 3. Off-site Restic backup (if configured in environment)
if ($env:RESTIC_REPOSITORY) {
    Write-Host "-> Initiating Restic snapshot to $env:RESTIC_REPOSITORY..."
    restic backup --tag folio $SqlDumpPath
    restic forget --keep-daily 30 --keep-weekly 8 --prune
} else {
    Write-Host "-> RESTIC_REPOSITORY environment variable not set; skipping off-site snapshot."
}

Write-Host "=== [Folio Backup] Finished successfully at $(Get-Date) ==="
