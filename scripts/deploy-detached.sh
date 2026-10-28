#!/bin/sh
# Запуск deploy.sh в фоне, отвязанно от SSH-сессии, — для CI.
#
# Сборка образов на сервере идёт дольше пяти минут, и SSH-сессия CI её не доживала («client_loop: send disconnect:
# Broken pipe»): деплой краснел, хотя сервер доделывал его сам. Теперь сессия только запускает деплой и уходит, а
# CI опрашивает ход коротким SSH (deploy-status.sh): обрыв одного опроса ничего не прерывает.
#
#   ./scripts/deploy-detached.sh   → печатает короткий хеш коммита, который выкладывается
#
# Журнал — deploy-logs/<хеш>.log, код завершения deploy.sh — deploy-logs/<хеш>.status (появляется в конце).
# Два деплоя разом не идут: второй, пока первый держит замок, не запускается (CI и так выстраивает их в очередь).
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

SHA="$(git rev-parse --short HEAD)"
LOGS="$DIR/deploy-logs"
mkdir -p "$LOGS"
LOCK="$LOGS/.lock"

# Старый код повторного запуска того же коммита не должен показаться CI итогом нового: стираем его, но только если
# сейчас ничего не выкладывается (иначе это итог идущего деплоя).
if flock -n "$LOCK" true; then
  rm -f "$LOGS/$SHA.status"
fi

# setsid + nohup: процесс уходит из группы SSH-сессии и не получает SIGHUP при её обрыве; ввод-вывод — не в сессию.
setsid nohup sh -c '
  exec 9>"$1"
  flock -n 9 || exit 0
  ./scripts/deploy.sh >"$2" 2>&1 </dev/null
  echo $? >"$3"
' deploy "$LOCK" "$LOGS/$SHA.log" "$LOGS/$SHA.status" >/dev/null 2>&1 </dev/null &

# Журналы старых деплоев: храним последние 20 пар.
ls -1t "$LOGS"/*.log 2>/dev/null | tail -n +21 | while read -r f; do rm -f "$f" "${f%.log}.status"; done

echo "$SHA"
