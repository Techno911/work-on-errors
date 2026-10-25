# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Tesseract нужен в builder только если OCR используется во время сборки.
# Добавляем его здесь тоже, чтобы выровнять окружение и упростить отладку.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-rus tesseract-ocr-data-eng

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Проверяем, что main.js действительно сгенерирован
RUN ls -la dist/main.js || (echo "=== BUILD FAILED: dist/main.js not found ===" && exit 1)

# Prune dev dependencies so only prod deps are copied to final image
RUN npm prune --production

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Tesseract OCR для распознавания текста на скриншотах переписок
# tesseract-ocr-data-rus tesseract-ocr-data-eng — языковые данные для русского текста
# ffmpeg — конвертация записей звонков в моно-MP3 перед транскрипцией
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-rus tesseract-ocr-data-eng ffmpeg

# Сертификаты НУЦ Минцифры: API SaluteSpeech (ngw.devices.sberbank.ru) работает только под ними.
# Лежат в репо (backend/certs/) — скачивание по URL при билде ненадёжно, ссылки Госуслуг меняются.
# NODE_EXTRA_CA_CERTS добавляет их к системным CA, не заменяя.
COPY certs/russian_trusted_root_ca.crt certs/russian_trusted_sub_ca.crt /app/certs/
RUN { cat /app/certs/russian_trusted_root_ca.crt; echo; cat /app/certs/russian_trusted_sub_ca.crt; echo; } > /app/certs/russian_trusted_bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_bundle.pem

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Uploads directory is mounted as a Docker volume in production
RUN mkdir -p uploads/screenshots uploads/audio uploads/audio/staging && chown -R node:node /app

# Run as non-root for security
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
