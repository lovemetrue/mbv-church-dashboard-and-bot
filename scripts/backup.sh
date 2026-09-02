#!/bin/sh
# Бэкап базы участников. Запускать из корня проекта.
# Хостовый cron (ежедневно в 03:00):
#   0 3 * * * cd /opt/church40bot && ./scripts/backup.sh >> backups/backup.log 2>&1
set -eu

KEEP_DAYS=14
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUPS="$DIR/backups"
mkdir -p "$BACKUPS"

# shellcheck source=/dev/null
POSTGRES_USER=$(grep -E '^POSTGRES_USER=' "$DIR/.env" | cut -d= -f2-)
POSTGRES_DB=$(grep -E '^POSTGRES_DB=' "$DIR/.env" | cut -d= -f2-)
: "${POSTGRES_USER:=church}"
: "${POSTGRES_DB:=church40}"

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$BACKUPS/church40-$STAMP.dump"

# -Fc это сжатый формат, восстанавливается через pg_restore.
docker compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$FILE"
echo "$(date '+%Y-%m-%d %H:%M') бэкап готов: $FILE ($(du -h "$FILE" | cut -f1))"

# Чистим старые копии.
find "$BACKUPS" -name 'church40-*.dump' -type f -mtime "+$KEEP_DAYS" -delete

# Восстановление:
#   docker compose exec -T db pg_restore -U church -d church40 --clean --if-exists < backups/файл.dump
