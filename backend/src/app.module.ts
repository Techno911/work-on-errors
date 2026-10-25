import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { getDatabaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { CrmIntegrationModule } from './crm-integration/crm-integration.module';
import { RolesModule } from './roles/roles.module';
import { SeedModule } from './seeds/seed.module';
import { SprintsModule } from './sprints/sprints.module';
import { EntriesModule } from './entries/entries.module';
import { ErrorTagsModule } from './error-tags/error-tags.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { InvitesModule } from './invites/invites.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { ReviewTemplatesModule } from './review-templates/review-templates.module';
import { GamificationModule } from './gamification/gamification.module';
import { RopBonusModule } from './rop-bonus/rop-bonus.module';
import { ShareModule } from './share/share.module';
import { OfferModule } from './offer/offer.module';
import { RopBonusOfferModule } from './rop-bonus-offer/rop-bonus-offer.module';
import { PlaybookModule } from './playbook/playbook.module';
import { AttestationModule } from './attestation/attestation.module';
import { CompanyEventsModule } from './company-events/company-events.module';
import { AccessModule } from './access/access.module';
import { PaymentHoldInterceptor } from './common/interceptors/payment-hold.interceptor';
import { Company } from './companies/entities/company.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    ThrottlerModule.forRoot([
      // Имя по умолчанию ('default') — иначе точечные @Throttle({ default: … }) на auth/analytics
      // не находят одноимённый throttler и молча игнорируются (login/forgot-password без защиты).
      { ttl: 60000, limit: 120 },
    ]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        getDatabaseConfig(configService),
      inject: [ConfigService],
    }),
    // Публично раздаём ТОЛЬКО аватары (не ПД). Записи звонков и скриншоты переписок —
    // персональные данные клиентов, отдаются через авторизованные эндпоинты
    // /entries/:id/audio/stream и /entries/:id/screenshots/:sid/file со scope-проверкой.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads', 'avatars'),
      serveRoot: '/uploads/avatars',
    }),
    CompanyEventsModule,
    AccessModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    TranscriptionModule,
    CrmIntegrationModule,
    RolesModule,
    SeedModule,
    SprintsModule,
    EntriesModule,
    ErrorTagsModule,
    AnalyticsModule,
    InvitesModule,
    NotificationsModule,
    AdminModule,
    DashboardModule,
    HealthModule,
    ReviewTemplatesModule,
    GamificationModule,
    RopBonusModule,
    ShareModule,
    OfferModule,
    RopBonusOfferModule,
    PlaybookModule,
    AttestationModule,
    // Репозиторий компаний нужен глобальному PaymentHoldGuard (он живёт в провайдерах модуля).
    TypeOrmModule.forFeature([Company]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Приостановка за неоплату закрывает работу команде клиента на уровне сервера, а не только
    // экраном: иначе прямой запрос к API обходит её. Наши роли не трогает.
    //
    // Именно ИНТЕРЦЕПТОР, а не guard: глобальные guard'ы Nest отрабатывают раньше контроллерных,
    // то есть до разбора токена, и видят запрос без пользователя. Первая редакция была guard'ом
    // и пропускала всё подряд при зелёных тестах, дефект нашёлся только прогоном на проде.
    { provide: APP_INTERCEPTOR, useClass: PaymentHoldInterceptor },
  ],
})
export class AppModule {}
