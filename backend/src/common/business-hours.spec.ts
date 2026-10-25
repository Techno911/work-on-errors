import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { businessHoursBetween } from './company-time.util';

/**
 * Норматив разбора считается в рабочих часах от момента сдачи записи.
 *
 * Оба прежних упрощения стоили клиенту одного клиента девяти ложных просрочек из шестнадцати
 * записей: часы шли от создания черновика (время менеджера списывалось руководителю) и
 * считались календарными (выходные попадали в норматив). Владелец читал это в отчёте как
 * провал дисциплины руководителя.
 */
describe('рабочие часы норматива', () => {
  const MSK = 'Europe/Moscow';
  // Даты сентября 2026 выбраны так, чтобы будни и выходные были однозначны:
  // 7 сентября 2026 это понедельник.
  const mskDate = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2026, 8, day, hour - 3, minute)); // МСК = UTC+3

  it('внутри одного рабочего дня считает фактические часы', () => {
    expect(businessHoursBetween(MSK, mskDate(7, 10), mskDate(7, 15))).toBe(5);
  });

  it('ночь между двумя днями не считается рабочим временем', () => {
    // Понедельник 17:00 → вторник 10:00: один час до конца дня плюс час с утра.
    expect(businessHoursBetween(MSK, mskDate(7, 17), mskDate(8, 10))).toBe(2);
  });

  it('выходные не входят в норматив: случай одного клиента', () => {
    // Запись сдана в пятницу 14:49, разобрана в понедельник 06:57. Календарно это 64 часа,
    // и платформа считала руководителя нарушителем. По рабочему времени он ответил за
    // три часа с небольшим, то есть уложился в норматив с запасом.
    const submitted = mskDate(11, 14, 49); // пятница
    const reviewed = mskDate(14, 6, 57); // понедельник, до начала рабочего дня
    const hours = businessHoursBetween(MSK, submitted, reviewed);
    expect(hours).toBeLessThanOrEqual(4);
    expect(hours).toBeGreaterThan(2);
    // Тот же интервал по календарю: ровно та цифра, которая ехала в отчёт собственнику.
    const calendar = (reviewed.getTime() - submitted.getTime()) / 3_600_000;
    expect(Math.round(calendar)).toBe(64);
  });

  it('суббота и воскресенье целиком не считаются', () => {
    expect(businessHoursBetween(MSK, mskDate(12, 9), mskDate(13, 18))).toBe(0);
  });

  it('таймзона компании учитывается: Камчатка живёт на девять часов раньше Москвы', () => {
    // 06:00 по Москве это 15:00 на Камчатке, то есть рабочее время там уже идёт.
    const from = mskDate(7, 6);
    const to = mskDate(7, 8);
    expect(businessHoursBetween('Asia/Kamchatka', from, to)).toBe(2);
    expect(businessHoursBetween(MSK, from, to)).toBe(0);
  });

  it('обратный порядок дат и мусор дают ноль, а не отрицательные часы', () => {
    expect(businessHoursBetween(MSK, mskDate(8, 10), mskDate(7, 10))).toBe(0);
    expect(businessHoursBetween(MSK, 'не дата', mskDate(7, 10))).toBe(0);
  });

  it('очень старая запись не вешает счёт бесконечным циклом', () => {
    const old = new Date(Date.UTC(2020, 0, 1));
    const hours = businessHoursBetween(MSK, old, mskDate(7, 10));
    expect(hours).toBeGreaterThan(0);
    expect(Number.isFinite(hours)).toBe(true);
  });
});

/**
 * Структурный замок. Поведенческие проверки выше не увидят, если завтра появится ЧЕТВЁРТОЕ
 * место, где просрочку считают по-старому: сейчас их три (сторож, аналитика, недельный отчёт),
 * и каждое считало от createdAt. Поэтому обходим весь бэкенд и запрещаем саму конструкцию.
 */
describe('нигде не осталось расчёта норматива от создания черновика', () => {
  const SRC = join(__dirname, '..');

  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (/\.ts$/.test(name) && !/\.spec\.ts$/.test(name)) acc.push(full);
    }
    return acc;
  };

  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  it('очередь ожидающих разбора отбирается по моменту сдачи, а не по createdAt', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!/EntryStatus\.SUBMITTED/.test(code)) continue;
      // Запрещаем сравнение порога с createdAt: именно эта строка жила во всех трёх местах.
      if (/entry\.createdAt\s*<=\s*:threshold/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('все три потребителя норматива считают рабочие часы', () => {
    const consumers = [
      'analytics/overdue.scheduler.ts',
      'analytics/analytics.service.ts',
      'analytics/weekly-report.scheduler.ts',
    ];
    for (const rel of consumers) {
      const code = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      expect({ file: rel, usesBusinessHours: /businessHoursBetween\s*\(/.test(code) })
        .toEqual({ file: rel, usesBusinessHours: true });
    }
  });
});
