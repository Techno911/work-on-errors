import * as fs from 'fs';
import { join } from 'path';
import { workingDaysSince } from '../common/company-time.util';

/**
 * Замки жизненного цикла клиента (05.08.2026, разбор клиента).
 *
 * Класс дефекта, который они стерегут: сигнал рождается только из события, поэтому клиент с
 * нулём активности невидим. У клиента это дало три с половиной месяца тишины при нуле сданных
 * записей, и ни один механизм об этом не сказал. Правки легко потерять обратной правкой
 * «чтобы не шумело», поэтому инварианты закреплены тестом, а не комментарием.
 *
 * Структурные проверки читают исходник БЕЗ комментариев: иначе объяснение ошибки в шапке файла
 * само по себе удовлетворяло бы (или заваливало) проверку.
 */

function sourceWithoutComments(relPath: string): string {
  const raw = fs.readFileSync(join(__dirname, '..', relPath), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // блочные, включая jsdoc
    .replace(/(^|[^:])\/\/.*$/gm, '$1 '); // строчные, не трогая «https://»
}

describe('рабочие дни для порогов подключения', () => {
  const tz = 'Europe/Moscow';

  it('выходные не считаются: пятница плюс сутки это ноль рабочих дней', () => {
    // 31.07.2026 пятница → 01.08 суббота
    expect(workingDaysSince(tz, new Date('2026-07-31T09:00:00Z'), new Date('2026-08-01T09:00:00Z'))).toBe(0);
  });

  it('пятница до понедельника это один рабочий день, а не три', () => {
    expect(workingDaysSince(tz, new Date('2026-07-31T09:00:00Z'), new Date('2026-08-03T09:00:00Z'))).toBe(1);
  });

  it('среда до пятницы это два рабочих дня (порог тревоги)', () => {
    expect(workingDaysSince(tz, new Date('2026-07-29T09:00:00Z'), new Date('2026-07-31T09:00:00Z'))).toBe(2);
  });

  it('кривая дата не роняет расчёт', () => {
    expect(workingDaysSince(tz, new Date('не дата'))).toBe(0);
  });
});

describe('свод здоровья не теряет клиента из виду', () => {
  const src = () => sourceWithoutComments('analytics/loop-guard.scheduler.ts');

  // Проверять надо ИМЕННО тело свода, а не весь файл: в том же планировщике живут контуры,
  // где пропуск паузы законен и нужен (дайджест РОПу, эскалация долга — это сигналы КОМАНДЕ
  // клиента, а её на паузе не дёргают). Проверка по всему файлу заваливала бы правильный код
  // и приучала бы обходить замок вместо того, чтобы его читать.
  const healthBody = () => {
    const s = src();
    const start = s.indexOf('async sendSuperadminHealth');
    expect(start).toBeGreaterThan(-1);
    return s.slice(start);
  };

  it('пауза не исключает компанию из свода', () => {
    // Регресс выглядел бы безобидно: «не шуметь про осознанную паузу». На деле это выключатель
    // зрения, из-за которого клиента пропал из свода на три с половиной месяца.
    expect(healthBody()).not.toMatch(/status\s*===\s*'paused'[\s\S]{0,80}continue/);
  });

  it('пауза в своде это строка со сроком возврата, а не исчезновение', () => {
    // Вторая половина того же инварианта: мало «не пропускать», надо ещё и сказать, до какого
    // числа пауза и почему — иначе к компании нечему вернуть внимание.
    expect(healthBody()).toMatch(/возврат ожидается/);
  });

  it('компания без единой записи даёт строку от даты старта работы', () => {
    const s = src();
    expect(s).toMatch(/launchedAt\s*\?\?\s*\w+\.workStartedAt\s*\?\?\s*\w+\.createdAt/);
    expect(s).toMatch(/ни одной записи за всё время/);
  });

  it('свод уходит даже когда находок нет: молчание неотличимо от смерти крона', () => {
    const s = src();
    expect(s).not.toMatch(/lines\.length\s*===\s*0\s*&&\s*!force\)\s*return/);
    expect(s).toMatch(/Проверено компаний/);
  });

  it('выданный доступ без входа виден в своде', () => {
    expect(src()).toMatch(/доступ выдан, входа нет/);
  });
});

describe('сторож выданных доступов', () => {
  const src = () => sourceWithoutComments('analytics/access-watch.scheduler.ts');

  it('сигнал уходит один раз на человека', () => {
    // Без проверки уже созданного уведомления ежечасный крон превратит сигнал в поток,
    // и его перестанут читать ровно те, кому он адресован.
    expect(src()).toMatch(/existsFor\(NotificationType\.ACCESS_NOT_USED/);
  });

  it('исторические учётки не поднимаются задним числом', () => {
    expect(src()).toMatch(/MAX_AGE_DAYS/);
  });

  it('пороги считаются в рабочих днях, а не в календарных', () => {
    expect(src()).toMatch(/workingDaysSince\(/);
  });
});

describe('канал до нашей стороны имеет больше одного носителя', () => {
  // Самая дорогая находка разбора: переменная SUPERADMIN_TG_CHAT_ID на проде не была задана,
  // поэтому свод здоровья, сигналы запуска, отказы распознавания и просьбы о помощи с CRM
  // уходили в никуда. Один носитель адреса, который никто не проверяет, это тот же механизм
  // дрейфа, что и «одно значение в двух местах». Замок обходит дерево, а не список файлов:
  // тест, знающий имена файлов, даёт ложное чувство закрытого класса.
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      const full = join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, acc);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) acc.push(full);
    }
    return acc;
  }

  it('никто не читает переменную окружения напрямую, кроме резолвера адресатов', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..'))) {
      if (file.endsWith('telegram.service.ts')) continue; // единственный законный носитель
      const src = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
      if (/process\.env\.SUPERADMIN_TG_CHAT_ID/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('резолвер собирает адрес из окружения и из личных привязок наших людей', () => {
    const src = sourceWithoutComments('analytics/telegram.service.ts');
    expect(src).toMatch(/async staffChatIds\(\)/);
    expect(src).toMatch(/UserRole\.SUPERADMIN/);
    expect(src).toMatch(/UserRole\.TRACKER/);
  });
});

describe('недельный отчёт при нуле записей', () => {
  const src = () => sourceWithoutComments('analytics/weekly-report.scheduler.ts');

  it('нулевая неделя подаётся как новость, а не как сводка нулей', () => {
    const s = src();
    // Проверка на НАЛИЧИЕ строк была слепой: слом «idleBlock = null» её не ронял, потому что
    // сам метод с текстом оставался в файле. Проверяем ИСПОЛЬЗОВАНИЕ: вердикт обязан ветвиться
    // по результату вызова, а вызов обязан быть настоящим (05.08.2026, найдено сломом).
    expect(s).toMatch(/const idleBlock = await this\.buildIdleBlock\(/);
    expect(s).toMatch(/const verdict = idleBlock\s*\n?\s*\?\s*idleBlock\.verdict/);
    expect(s).toMatch(/Работа стоит/);
  });

  it('тема письма при простое называет проблему', () => {
    expect(src()).toMatch(/разбор звонков стоит/);
  });

  it('в блоке простоя есть имена не входивших', () => {
    expect(src()).toMatch(/Ни разу не входили/);
  });

  it('возобновившаяся работа не объявляется простоем', () => {
    // Граничное значение: за прошлую неделю ноль, но команда уже сдаёт на этой. Без порога
    // отчёт печатал «работа стоит 0 дней» (поймано на живых данных клиента, а не тестом).
    expect(src()).toMatch(/if \(last && days < 3\) return null;/);
  });
});


/**
 * Приостановка за неоплату (13.08.2026). Отдельная от паузы сущность: платформа закрыта всей
 * команде НАШИМ решением, сдать запись физически нельзя. Механика закрытия была написана
 * 10.08.2026, а состояние никто из сторожей не знал — свод писал клиента «8 дней без новых
 * записей» без пометки, а недельный отчёт собственнику готовился уйти с нулями за неделю,
 * которую мы же и закрыли. Класс дефекта: замок поставлен, а состояние в сигналы не заведено.
 */
describe('доступ, закрытый нами за неоплату', () => {
  const src = (rel: string) => sourceWithoutComments(rel);

  const healthBody = () => {
    const s = src('analytics/loop-guard.scheduler.ts');
    const start = s.indexOf('async sendSuperadminHealth');
    expect(start).toBeGreaterThan(-1);
    return s.slice(start);
  };

  it('в своде приостановка не исчезает: у неё своя строка с датой', () => {
    // Зеркало правила про паузу: из НАШЕГО наблюдения выпасть нельзя ни в одном состоянии.
    expect(healthBody()).not.toMatch(/paymentHold[\s\S]{0,80}continue/);
    expect(healthBody()).toMatch(/доступ закрыт за неоплату/);
  });

  it('строки свода помечены тегом, а не выдают закрытие за обычную работу', () => {
    expect(healthBody()).toMatch(/company\.paymentHold\s*\?\s*' \(доступ закрыт за неоплату\)'/);
  });

  it('пометкой снабжена КАЖДАЯ строка компании, а не выборочные', () => {
    // Понедельничная строка про РОПа без Telegram оставалась единственной без тега и потому
    // читалась как претензия к работающему клиенту. Считаем вхождения тега, а не факт наличия.
    const body = healthBody();
    // Строки свода собираются как StaffSignal (id + stage + text), а не как готовый список
    // текстов: смотрим на поле text каждого сигнала.
    const withName = body.match(/text:\s*\n?\s*`[^`]*\$\{esc\(company\.name\)\}[^`]*`/g) ?? [];
    const named = withName.filter((l) => !/на паузе|доступ закрыт за неоплату/.test(l));
    expect(named.length).toBeGreaterThan(3);
    expect(named.every((l) => l.includes('${tag}'))).toBe(true);
  });

  it('дни приостановки в простой клиента не идут', () => {
    // Обе ветки: и «давно не было записей», и «не было никогда». Считать дни, когда вход
    // закрыт нами, значит выставлять клиенту наш же счёт как его простой. Окно передаётся
    // целиком (включая уже снятую приостановку), иначе после открытия счётчик их догонит.
    const body = healthBody();
    expect(body).toMatch(/const daysQuiet = idleWorkingDays\([\s\S]{0,80}holdWindow\)/);
    expect(body).toMatch(/const daysSinceStart = idleWorkingDays\([\s\S]{0,80}holdWindow\)/);
    expect(body).toMatch(/holdWindow = company\.paymentHoldInfo\?\.startedAt/);
    expect(body).toMatch(/to: company\.paymentHoldInfo\.liftedAt/);
    // Календарная арифметика по миллисекундам из счётчиков простоя убрана целиком.
    expect(body).not.toMatch(/days(Quiet|SinceStart) = Math\.floor/);
  });

  it('свод не приходит в выходные', () => {
    // В субботу и воскресенье он повторял бы пятничные строки, а действовать по ним некому.
    const src = sourceWithoutComments('analytics/loop-guard.scheduler.ts');
    expect(src).toMatch(/@Cron\('0 9 \* \* 1-5', \{ name: 'superadmin-loop-health' \}\)/);
  });

  it('очередь на разбор меряется тем же способом, что и норматив', () => {
    // Норматив с 10.08.2026 считает рабочие часы от МОМЕНТА СДАЧИ. Свод остался на календарных
    // днях от создания записи и в воскресенье 23.08 обвинил одного клиента в просрочке, которой
    // не было. Две модели одной величины сведены в одну.
    const body = healthBody();
    expect(body).toMatch(/order: \{ submittedAt: 'ASC' \}/);
    expect(body).toMatch(/businessHoursBetween\(company\.timezone/);
    expect(body).toMatch(/oldestHours >= maxHours \|\| pendingCount >= 5/);
    expect(body).not.toMatch(/oldestDays/);
  });

  it('недельный отчёт собственнику при закрытом доступе не уходит', () => {
    const s = src('analytics/weekly-report.scheduler.ts');
    const start = s.indexOf('async processCompany');
    expect(start).toBeGreaterThan(-1);
    expect(s.slice(start)).toMatch(/if \(company\.paymentHold\)[\s\S]{0,200}return false;/);
  });

  it('сторож доступов глушит клиента одним источником правды, а не ручной проверкой статуса', () => {
    // Ручная проверка `status === 'paused'` и была причиной: приостановку она не знает,
    // и человека просили войти на платформу, вход в которую ему закрыт.
    const s = src('analytics/access-watch.scheduler.ts');
    expect(s).toMatch(/const muteClient = !canSignalClient\(company\)/);
    expect(s).not.toMatch(/=== 'paused'/);
  });

  it('нам сигнал о невостребованном доступе уходит в любом состоянии клиента', () => {
    // Вторая половина инварианта: приглушаем КЛИЕНТА, а не своё зрение.
    const s = src('analytics/access-watch.scheduler.ts');
    const staffPart = s.slice(s.indexOf('staffChatIds'));
    expect(staffPart).not.toMatch(/muteClient/);
  });
});
