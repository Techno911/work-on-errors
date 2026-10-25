import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchdogRun } from './entities/watchdog-run.entity';
import { StaffNotifierService, StaffSignal, WATCHDOGS } from './staff-notifier.service';

/**
 * Сторож сторожей.
 *
 * До 03.09.2026 живость крона доказывалась тем, что свод здоровья приходил владельцу каждое
 * утро даже с текстом «всё чисто»: молчащий сторож неотличим от упавшего. Плата за это
 * доказательство — сообщение без ценности каждый день, и владелец его отменил.
 *
 * Доказательство осталось, поменялся носитель: каждый сторож ставит отметку о прогоне, а
 * этот механизм ежечасно сверяет отметки с ожидаемым ритмом. Сообщение уходит только когда
 * сторож ЗАМОЛЧАЛ, то есть когда оно требует действия. Разница ровно в том, что человек
 * получает новость, а не отчёт о нормальной работе.
 *
 * Кто сторожит его самого: отметку он ставит себе тоже (через report), и собственный разрыв
 * поднимает следующим же прогоном. Полная смерть процесса ловится не отсюда, а внешним
 * health-check'ом сервера — здесь регресса нет: раньше её тоже ловил не этот код.
 */
@Injectable()
export class WatchdogLivenessScheduler {
  constructor(
    @InjectRepository(WatchdogRun) private readonly runRepo: Repository<WatchdogRun>,
    private readonly notifier: StaffNotifierService,
  ) {}

  @Cron('0 * * * *', { name: 'watchdog-liveness' })
  async check(): Promise<void> {
    await this.run();
  }

  async run(): Promise<StaffSignal[]> {
    const rows = await this.runRepo.find();
    const now = Date.now();
    const signals: StaffSignal[] = [];

    for (const w of WATCHDOGS) {
      const row = rows.find((r) => r.key === w.key);
      // Незарегистрированный сторож не бывает: строку заводит StaffNotifierService при старте.
      // Если строки всё-таки нет, это и есть авария — механизм не поднялся ни разу.
      const hours = row ? (now - new Date(row.lastRunAt).getTime()) / 3_600_000 : Infinity;
      if (hours <= w.maxSilenceHours) continue;
      const since = row ? new Date(row.lastRunAt).toLocaleString('ru-RU') : 'ни разу с момента запуска';
      signals.push({
        id: `silent:${w.key}`,
        text:
          `🛑 <b>${w.label}</b> не отчитывался ${Number.isFinite(hours) ? `${Math.round(hours)} ч` : 'ни разу'}` +
          ` (норма ${w.maxSilenceHours} ч, последний прогон: ${since}).` +
          ` Проверьте контейнер backend: расписание не отрабатывает, значит сигналы не считаются вовсе.`,
      });
    }

    await this.notifier.report('watchdog-liveness', '🛑 <b>Сторож молчит</b>', signals, {
      repeatAfterDays: 3,
    });
    return signals;
  }
}
