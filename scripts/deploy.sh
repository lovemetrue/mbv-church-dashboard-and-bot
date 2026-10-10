#!/bin/sh
# Поднимает bot, dashboard и home-groups по отдельности и по порядку: миграции
# накатывает только bot при старте, а остальные — нет (см. CLAUDE.md, «Два
# процесса, одна база»). Если поднять их одновременно, дашборд может достучаться
# до схемы раньше, чем bot её обновит. Поэтому сначала bot, и только когда он
# подтвердит в логе, что миграции применены, — dashboard, а затем home-groups
# (новый интерфейс ходит в ту же базу и так же зависит от свежей схемы).
#
# Запускать из корня проекта, после git pull. Вызывается по SSH из
# .github/workflows/ci.yml; бэкап и git pull — снаружи этого скрипта, в самом
# workflow, чтобы даже в первый раз, когда deploy.sh ещё не лежит на сервере,
# git pull успел его туда принести до попытки запуска.
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

docker compose up -d --build bot

echo "жду, пока bot применит миграции…"
i=0
until docker compose logs bot 2>&1 | grep -q 'схема базы актуальна'; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "bot не подтвердил миграции за 60 секунд — смотрите docker compose logs bot" >&2
    exit 1
  fi
  sleep 2
done
echo "bot готов"

docker compose up -d --build dashboard
docker compose up -d --build home-groups
# На случай, если в docker-compose.yml поменялось что-то у db/valkey —
# сами они не пересобираются (образы, не build:.), но пересоздать при
# изменении конфигурации всё равно нужно.
docker compose up -d

# Таймер бэкапа (deploy/systemd/) переустанавливаем на каждый деплой, чтобы правки
# юнитов доезжали до сервера сами. Root тут не гарантирован: пользователь деплоя может
# быть в группе docker без sudo, тогда просто печатаем, что делать руками, и не роняем
# деплой — сам deploy.sh про Google Drive и systemd ничего не знает и знать не должен.
if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
  SUDO=""
  [ "$(id -u)" = "0" ] || SUDO="sudo"
  $SUDO cp deploy/systemd/church40-backup.service deploy/systemd/church40-backup.timer /etc/systemd/system/
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now church40-backup.timer
  echo "таймер бэкапа обновлён"
else
  echo "нет root/sudo — таймер бэкапа не обновлён, поставьте вручную по deploy/systemd/README.md" >&2
fi

# Порт нового интерфейса берём из .env построчно, а не через `. ./.env`: в файле
# есть значения с пробелами и «;» (CHURCH_BRANCHES), shell их не переварит.
HG_PORT_VALUE="$(grep -E '^HG_PORT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r"\047 ' || true)"
echo "деплой завершён: $(git rev-parse --short HEAD)"
echo "новый интерфейс «Домашние группы»: http://127.0.0.1:${HG_PORT_VALUE:-8092}/ (с сервера; снаружи — через nginx или DASHBOARD_BIND, см. README)"
