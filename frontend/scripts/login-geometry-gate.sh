#!/usr/bin/env bash
# Живой замер сетки входа. Числа канона живут только в геометрия.py.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
PYTHON="${CHIP_GEOMETRY_PYTHON:-python3}"
MEASURE="${CHIP_GEOMETRY_SCRIPT:-$HOME/code/chip-first-touch/геометрия.py}"

[[ -x "$PYTHON" ]] || {
  echo "ОШИБКА: недоступно Playwright-окружение измерителя: $PYTHON" >&2
  exit 1
}
[[ -f "$MEASURE" ]] || {
  echo "ОШИБКА: недоступен единый измеритель сетки входа: $MEASURE" >&2
  exit 1
}

cd "$ROOT"
npm run build

PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
PREVIEW_LOG="$(mktemp "${TMPDIR:-/tmp}/ro-login-preview.XXXXXX.log")"
PREVIEW_PID=''

cleanup() {
  if [[ -n "$PREVIEW_PID" ]] && kill -0 "$PREVIEW_PID" 2>/dev/null; then
    kill "$PREVIEW_PID" 2>/dev/null || true
    wait "$PREVIEW_PID" 2>/dev/null || true
  fi
  rm -f "$PREVIEW_LOG"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port "$PORT" --strictPort >"$PREVIEW_LOG" 2>&1 &
PREVIEW_PID=$!

ready='false'
for _ in $(seq 1 80); do
  if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
    echo 'ОШИБКА: preview завершился до замера:' >&2
    cat "$PREVIEW_LOG" >&2
    exit 1
  fi
  if curl --fail --silent --show-error --max-time 1 "http://127.0.0.1:$PORT/login" >/dev/null 2>&1; then
    ready='true'
    break
  fi
  sleep 0.25
done

if [[ "$ready" != 'true' ]]; then
  echo "ОШИБКА: preview не поднялся на порту $PORT:" >&2
  cat "$PREVIEW_LOG" >&2
  exit 1
fi

"$PYTHON" "$MEASURE" \
  --urls "Работа над ошибками=http://localhost:$PORT/login" \
  --widths 1440,1920,2560,3440 \
  --gate
