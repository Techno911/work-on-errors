import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

async function bootstrap() {
  // Проверяем JWT_SECRET до старта приложения
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME') {
    console.error('❌ JWT_SECRET not configured! Set it in .env');
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // За nginx: доверяем одному прокси, чтобы req.ip был реальным клиентским. Иначе rate-limit
  // (ThrottlerGuard) ключуется на IP nginx — единый на всех → лимит login становится общим
  // (взаимная блокировка входа + один бот исчерпывает бюджет для всех).
  app.set('trust proxy', 1);

  // Тело до 2 МБ: транскрипция звонка заявлена до 500 000 символов, а дефолт body-parser (100 КБ)
  // ронял её сохранение с непонятным клиенту 500. Покрывает 500k символов UTF-8 с запасом.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  // Security headers
  app.use(helmet());

  // Correlation ID for request tracing
  app.use(CorrelationIdMiddleware);

  // CORS
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
  const isDev = configService.get('NODE_ENV') !== 'production';
  app.enableCors({
    origin: isDev
      ? (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => cb(null, true)
      : frontendUrl,
    credentials: true,
  });

  // Cookie parser for refresh tokens
  app.use(cookieParser());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global serializer (respects @Exclude())
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Публичная статика — ТОЛЬКО аватары (не ПД). Записи звонков и скриншоты переписок
  // отдаются авторизованными эндпоинтами entries (scope-проверка company + ownership).
  app.useStaticAssets(join(__dirname, '..', 'uploads', 'avatars'), { prefix: '/uploads/avatars/' });

  // API prefix
  app.setGlobalPrefix('api');

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
