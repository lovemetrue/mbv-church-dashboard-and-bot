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

# ── Итоговый образ ──────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
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
