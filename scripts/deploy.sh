#!/bin/sh
# Поднимает bot и dashboard по отдельности и по порядку: миграции накатывает
# только bot при старте, а dashboard — нет (см. CLAUDE.md, «Два процесса, одна
# база»). Если поднять их одновременно, дашборд может достучаться до схемы
# раньше, чем bot её обновит. Поэтому сначала bot, и только когда он подтвердит
# в логе, что миграции применены, — dashboard.
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
# На случай, если в docker-compose.yml поменялось что-то у db/valkey —
# сами они не пересобираются (образы, не build:.), но пересоздать при
# изменении конфигурации всё равно нужно.
docker compose up -d

echo "деплой завершён: $(git rev-parse --short HEAD)"
