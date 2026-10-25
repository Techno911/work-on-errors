import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { TelegramService } from './telegram.service';
import { OverdueScheduler } from './overdue.scheduler';
import { LoopGuardScheduler } from './loop-guard.scheduler';
import { WeeklyReportScheduler } from './weekly-report.scheduler';
import { RopBonusPayoutScheduler } from './rop-bonus-payout.scheduler';
import { TelegramContact } from './entities/telegram-contact.entity';
import { TelegramDetectedChat } from './entities/telegram-detected-chat.entity';
import { TelegramLinkController } from './telegram-link.controller';
import { RopBonusModule } from '../rop-bonus/rop-bonus.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LaunchScheduler } from './launch.scheduler';
import { AccessWatchScheduler } from './access-watch.scheduler';
import { PauseWatchScheduler } from './pause-watch.scheduler';
import { ChannelCheckScheduler } from './channel-check.scheduler';
import { OwnerReachService } from './owner-reach.service';
import { StaffNotifierService } from './staff-notifier.service';
import { StaffSignalState } from './entities/staff-signal-state.entity';
import { WatchdogRun } from './entities/watchdog-run.entity';
import { WatchdogLivenessScheduler } from './watchdog-liveness.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      Entry,
      ErrorTag,
      Company,
      User,
      TelegramContact,
      TelegramDetectedChat,
      Sprint,
      StaffSignalState,
      WatchdogRun,
    ]),
    RopBonusModule,
    GamificationModule,
    NotificationsModule,
  ],
  controllers: [AnalyticsController, TelegramLinkController],
  providers: [
    AnalyticsService,
    TelegramService,
    OwnerReachService,
    StaffNotifierService,
    WatchdogLivenessScheduler,
    OverdueScheduler,
    LoopGuardScheduler,
    WeeklyReportScheduler,
    RopBonusPayoutScheduler,
    LaunchScheduler,
    AccessWatchScheduler,
    PauseWatchScheduler,
    ChannelCheckScheduler,
  ],
  exports: [
    AnalyticsService,
    OwnerReachService,
    WeeklyReportScheduler,
    RopBonusPayoutScheduler,
    LoopGuardScheduler,
    TelegramService,
    AccessWatchScheduler,
    PauseWatchScheduler,
    ChannelCheckScheduler,
    StaffNotifierService,
    WatchdogLivenessScheduler,
  ],
})
export class AnalyticsModule {}
