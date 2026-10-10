# syntax=docker/dockerfile:1

# ── Сборка ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Зависимости для прода ───────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Интерфейс «Домашние группы» (React + Vite) ──────────────────────────────
# Отдельная стадия: в итоговый образ попадает только готовая статика, а Vite и
# весь его node_modules остаются здесь. Сначала копируем одни package*.json и
# ставим зависимости, и только потом исходники: пока lock-файл не менялся, слой
# с npm ci берётся из кэша, и правка компонента не перекачивает пакеты заново.
FROM node:24-alpine AS web
WORKDIR /app/web/home-groups
COPY web/home-groups/package.json web/home-groups/package-lock.json ./
RUN npm ci
COPY web/home-groups ./
# Интерфейс импортирует типы из ../../../src/home-groups/contracts.ts, поэтому файл
# должен лежать по тому же относительному пути, что и в репозитории. Остальной src
# не копируем: контракт самодостаточен, а лишний src сбрасывал бы кэш сборки
# интерфейса при каждой правке бота.
COPY src/home-groups/contracts.ts /app/src/home-groups/contracts.ts
RUN npm run build

# ── Итоговый образ ──────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Собранный интерфейс «Домашние группы»: его раздаёт сервис home-groups (HG_WEB_DIR).
COPY --from=web /app/web/home-groups/dist ./web-dist
# Миграции нужны в рантайме: бот применяет их сам при старте.
COPY migrations ./migrations
# Файл дашборда читается сервисом на каждый запрос.
COPY dashboard/home-groups.html ./dashboard/home-groups.html
# Фавикон и другая статика, на которую ссылается home-groups.html.
COPY dashboard/assets ./dashboard/assets
# Импорт выгрузки в базу — рабочая операция на сервере, а не сборочный шаг.
COPY dashboard/data.json ./dashboard/data.json
COPY scripts ./scripts
COPY package.json ./

# Не работаем под root.
USER node

CMD ["node", "dist/index.js"]
