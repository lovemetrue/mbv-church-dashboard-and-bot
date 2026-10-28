#!/bin/sh
# Ход фонового деплоя (deploy-detached.sh) — для опроса из CI.
#
#   ./scripts/deploy-status.sh <хеш> <с какого байта журнала>
#
# Первая строка — «@@ <размер журнала> <код завершения или ->», дальше — новая часть журнала начиная с байта.
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/deploy-logs/$1.log"
STATUS="$DIR/deploy-logs/$1.status"
FROM="${2:-0}"

# Сначала код, потом размер: код пишется после последней строки журнала, и так конец журнала не потеряется.
CODE=-
[ -f "$STATUS" ] && CODE="$(cat "$STATUS")"
SIZE=0
[ -f "$LOG" ] && SIZE="$(wc -c <"$LOG" | tr -d ' ')"
echo "@@ $SIZE $CODE"
if [ -f "$LOG" ] && [ "$SIZE" -gt "$FROM" ]; then
  tail -c +"$((FROM + 1))" "$LOG" | head -c "$((SIZE - FROM))"
fi
