#!/usr/bin/env bash
# Генерирует .env со случайными секретами для локального запуска.
# Файл пишется атомарно с umask 077 (временного 0644 не бывает) и игнорируется git.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env уже существует — не затираю. Удалите вручную, если нужна новая генерация." >&2
  exit 1
fi
rand() { openssl rand -hex "${1:-24}"; }
tmp="$(mktemp -t woe-env.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
umask 077
{
  sed -e "s/^DB_PASSWORD=$/DB_PASSWORD=$(rand 16)/" \
      -e "s/^JWT_SECRET=$/JWT_SECRET=$(rand 32)/" \
      -e "s/^JWT_REFRESH_SECRET=$/JWT_REFRESH_SECRET=$(rand 32)/" \
      -e "s/^SEED_ADMIN_PASSWORD=$/SEED_ADMIN_PASSWORD=$(rand 12)/" \
      -e "s/^SEED_DEMO_PASSWORD=$/SEED_DEMO_PASSWORD=$(rand 12)/" \
      -e "s/^CRM_ENCRYPTION_KEY=$/CRM_ENCRYPTION_KEY=$(rand 24)/" .env.example
} > "$tmp"
mv "$tmp" .env
trap - EXIT
chmod 600 .env
echo ".env создан (0600). Пароли демо-доступов — внутри файла."
