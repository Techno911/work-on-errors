# ── Stage 0: Browser for OG-render gate ───────────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS og-renderer

# Один Linux-рендерер для локальной проверки и сборки.
RUN apk add --no-cache chromium=149.0.7827.53-r0
ENV OG_BROWSER_BIN=/usr/bin/chromium-browser

# ── Stage 1: Build (root workspaces: единое дерево @types/react, @chirkov/shell — symlink) ──
FROM og-renderer AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ui/package.json ./packages/ui/
COPY backend/package.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci

COPY packages/ui ./packages/ui
RUN npm run build -w packages/ui

COPY frontend ./frontend
# VITE_API_URL is injected at build time; defaults to /api (nginx proxy)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w frontend

# ── Stage 2: Production image (nginx) ─────────────────────────────────────────
FROM nginx:alpine

# Copy built SPA
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Custom nginx config with SPA fallback and API proxy
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
