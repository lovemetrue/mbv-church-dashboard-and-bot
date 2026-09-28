#!/bin/sh
# Бэкап базы участников: дамп → Google Drive. Запускать из корня проекта.
# На сервере запускается systemd-таймером (см. deploy/systemd/), а не cron —
# подробности установки в deploy/systemd/README.md.
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

# Имя rclone-remote'а и путь на Google Drive — настраиваются в .env (см. .env.example).
# Remote заводится один раз вручную командой `rclone config` (см. deploy/systemd/README.md):
# сюда попадает только имя уже настроенного remote'а, сам OAuth-ключ в репозиторий не идёт.
GDRIVE_REMOTE=$(grep -E '^GDRIVE_REMOTE=' "$DIR/.env" | cut -d= -f2-)
GDRIVE_BACKUP_PATH=$(grep -E '^GDRIVE_BACKUP_PATH=' "$DIR/.env" | cut -d= -f2-)
: "${GDRIVE_REMOTE:=gdrive}"
: "${GDRIVE_BACKUP_PATH:=church40-backups/church40.dump}"

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$BACKUPS/church40-$STAMP.dump"

# -Fc это сжатый формат, восстанавливается через pg_restore.
docker compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$FILE"
echo "$(date '+%Y-%m-%d %H:%M') бэкап готов: $FILE ($(du -h "$FILE" | cut -f1))"

# Локально держим короткую историю на случай, если сам rclone недоступен или упал —
# тогда хотя бы этот дамп остаётся на диске для ручной заливки. Старые копии чистим,
# независимо от исхода заливки в Drive.
find "$BACKUPS" -name 'church40-*.dump' -type f -mtime "+$KEEP_DAYS" -delete

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone не установлен — бэкап остался только локально в $FILE. Установите rclone" \
    "и настройте remote «$GDRIVE_REMOTE» (см. deploy/systemd/README.md)." >&2
  exit 1
fi

# copyto на фиксированный путь сам заменяет содержимое файла на Drive — второй версии
# не появляется. Старые ревизии, которые Google Drive держит по умолчанию, он же сам
# и вычищает через 30 дней (мы их не «закрепляем» флагом keepRevisionForever), так что
# отдельный шаг удаления не нужен.
rclone copyto "$FILE" "$GDRIVE_REMOTE:$GDRIVE_BACKUP_PATH"
echo "$(date '+%Y-%m-%d %H:%M') бэкап загружен на Google Drive: $GDRIVE_REMOTE:$GDRIVE_BACKUP_PATH"

# Восстановление:
#   docker compose exec -T db pg_restore -U church -d church40 --clean --if-exists < backups/файл.dump
# Или сначала скачать актуальную копию с Drive:
#   rclone copyto gdrive:church40-backups/church40.dump backups/из-drive.dump
