#!/bin/sh
# Скачивает самый свежий дамп базы с сервера на свой компьютер — обёртка над scp,
# чтобы не искать руками актуальное имя файла (штамп времени в имени меняется).
# Запускать локально, у себя на компьютере, а не на сервере.
#
# Репозиторий публичный, поэтому адрес сервера и путь к ключу сюда не зашиты —
# задайте их переменными окружения (у каждого разработчика свои):
#   export CHURCH40_HOST=root@5.23.48.25
#   export CHURCH40_KEY=~/.ssh/mbv-church-ssh       # необязательно
#   export CHURCH40_REMOTE_DIR=/opt/church40bot      # необязательно, это и есть умолчание
#
# Использование: scripts/fetch-backup.sh [куда сохранить, по умолчанию — текущая папка]
set -eu

: "${CHURCH40_HOST:?Задайте CHURCH40_HOST, например: export CHURCH40_HOST=root@1.2.3.4}"
REMOTE_DIR="${CHURCH40_REMOTE_DIR:-/opt/church40bot}"
DEST="${1:-.}"
SSH_KEY_OPT=""
[ -n "${CHURCH40_KEY:-}" ] && SSH_KEY_OPT="-i $CHURCH40_KEY"

# shellcheck disable=SC2086
LATEST=$(ssh $SSH_KEY_OPT "$CHURCH40_HOST" "ls -t $REMOTE_DIR/backups/church40-*.dump 2>/dev/null | head -1")
[ -n "$LATEST" ] || { echo "на сервере нет ни одного дампа в $REMOTE_DIR/backups/" >&2; exit 1; }

echo "тяну $LATEST…"
# shellcheck disable=SC2086
scp $SSH_KEY_OPT "$CHURCH40_HOST:$LATEST" "$DEST/"
echo "готово: $DEST/$(basename "$LATEST")"
