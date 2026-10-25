import * as fs from 'fs';
import { join } from 'path';

/**
 * Замки волн 2 и 3 (05.08.2026). Все проверки читают исходник БЕЗ комментариев: иначе
 * объяснение правила в шапке файла само по себе удовлетворяло бы проверку, и замок ослеп бы
 * ровно в тот момент, когда живой код испортили.
 *
 * Каждый замок проверен негативно в момент написания: слом живого кода роняет тест.
 */
function sourceWithoutComments(relPath: string): string {
  const raw = fs.readFileSync(join(__dirname, '..', relPath), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

describe('пауза это состояние с условиями, а не ярлык', () => {
  const admin = () => sourceWithoutComments('admin/admin.service.ts');

  it('через общий выбор статуса паузу поставить нельзя', () => {
    // Иначе пауза снова станет словом без срока: у клиента ровно это дало 112 дней невидимости.
    const s = admin();
    expect(s).toMatch(/status === 'paused'[\s\S]{0,400}throw new BadRequestException/);
  });

  it('пауза требует причины и даты возврата', () => {
    const s = admin();
    expect(s).toMatch(/Укажите причину паузы/);
    expect(s).toMatch(/Укажите планируемую дату возврата/);
  });

  it('предельный срок паузы ограничен, а не бесконечен', () => {
    expect(admin()).toMatch(/maxDays\s*=\s*60/);
  });

  it('снятие паузы чистит её условия, чтобы старая причина не пережила возврат', () => {
    expect(admin()).toMatch(/wasPaused\)\s*company\.pauseInfo = \{\}/);
  });
});

describe('сторож паузы возвращает внимание по дате', () => {
  const src = () => sourceWithoutComments('analytics/pause-watch.scheduler.ts');

  it('пауза без условий поднимается отдельно: молчать о ней нельзя', () => {
    expect(src()).toMatch(/Пауза без условий/);
  });

  it('просроченная пауза поднимается', () => {
    expect(src()).toMatch(/daysOverdue >= 0/);
  });

  it('сигнал идёт нашей стороне, а не команде клиента', () => {
    const s = src();
    // Адресат нашей стороны задаётся единственной дверью StaffNotifierService: у alert()
    // другого адресата не бывает по построению (03.09.2026). Прямой вызов staffChatIds
    // отсюда запрещён отдельным замком staff-notifier.spec.ts.
    expect(s).toMatch(/this\.notifier\.alert\(/);
    // Признак ошибки: рассылка в каналы владельца прямо из сторожа паузы.
    expect(s).not.toMatch(/reportChannels/);
  });

  it('напоминания не превращаются в поток', () => {
    expect(src()).toMatch(/REMIND_EVERY_DAYS/);
  });
});

describe('перезапуск это отдельное действие, а не снятие галочки', () => {
  const admin = () => sourceWithoutComments('admin/admin.service.ts');

  it('перезапуск ставит новую точку отсчёта и включает сторожа заново', () => {
    const s = admin();
    const start = s.indexOf('async relaunchCompany');
    expect(start).toBeGreaterThan(-1);
    const body = s.slice(start, start + 2500);
    expect(body).toMatch(/company\.launchedAt = new Date\(\)/);
    expect(body).toMatch(/company\.status = 'launch'/);
  });

  it('перезапуск невозможен там, где запуска ещё не было', () => {
    expect(admin()).toMatch(/Работа ещё не запускалась/);
  });
});

describe('журнал событий компании', () => {
  it('запись в журнал не роняет саму операцию', () => {
    const s = sourceWithoutComments('company-events/company-events.service.ts');
    expect(s).toMatch(/catch \(err\)[\s\S]{0,200}logger\.warn/);
  });

  it('доставка сигнала пишется и при успехе, и при отказе', () => {
    const s = sourceWithoutComments('company-events/company-events.service.ts');
    expect(s).toMatch(/SIGNAL_SENT/);
    expect(s).toMatch(/SIGNAL_FAILED/);
  });

  it('недельный отчёт оставляет след о доставке', () => {
    // Именно этого следа не хватало, чтобы ответить на вопрос «а отчёт вообще уходил».
    const s = sourceWithoutComments('analytics/weekly-report.scheduler.ts');
    expect((s.match(/logDelivery\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('доступ доставляется ссылкой, а не паролем', () => {
  it('в сообщении команде пароля нет ни в каком виде', () => {
    const s = sourceWithoutComments('admin/launch-message.ts');
    expect(s).not.toMatch(/tg-spoiler/);
    expect(s).toMatch(/activationUrl/);
  });

  it('ссылка одноразовая и с коротким сроком жизни', () => {
    const s = sourceWithoutComments('access/access-delivery.service.ts');
    expect(s).toMatch(/ACTIVATION_TTL_MS\s*=\s*3 \* 24 \* 3600 \* 1000/);
  });

  it('токен гасится после применения', () => {
    const s = sourceWithoutComments('users/users.service.ts');
    const start = s.indexOf('async consumeActivationToken');
    expect(start).toBeGreaterThan(-1);
    const body = s.slice(start, start + 900);
    expect(body).toMatch(/activationToken = null/);
  });

  it('логика доставки доступа живёт в одном месте, а не копией у трекера и владельца', () => {
    // Копия преобразования опаснее копии значения: обе честные, расходятся молча.
    const admin = sourceWithoutComments('admin/admin.service.ts');
    const dash = sourceWithoutComments('dashboard/dashboard.service.ts');
    expect(admin).toMatch(/accessDelivery\.sendUserAccess/);
    expect(dash).toMatch(/adminAccess\.sendUserAccess/);
    // Ни один из них не собирает текст сообщения сам.
    expect(admin).not.toMatch(/Ссылка входа \(ваша личная/);
    expect(dash).not.toMatch(/Ссылка входа \(ваша личная/);
  });
});

describe('экран состояния собственника', () => {
  const src = () => sourceWithoutComments('dashboard/dashboard.service.ts');

  it('отвечает на три вопроса в порядке: идёт ли работа, кто не делает, что от меня надо', () => {
    const s = src();
    const start = s.indexOf('async getOwnerState');
    expect(start).toBeGreaterThan(-1);
    const body = s.slice(start, start + 6000);
    expect(body.indexOf('work:')).toBeGreaterThan(-1);
    expect(body.indexOf('people,')).toBeGreaterThan(body.indexOf('work:'));
    expect(body.indexOf('actions,')).toBeGreaterThan(body.indexOf('people,'));
  });

  it('называет людей поимённо, а не процентами вовлечённости', () => {
    const s = src();
    expect(s).toMatch(/ни разу не входил/);
    expect(s).not.toMatch(/вовлечённость/i);
  });

  it('наш операционный статус клиенту не показывается', () => {
    const s = src();
    const start = s.indexOf('async getOwnerState');
    const body = s.slice(start, start + 6000);
    // «Запуск» и «На паузе» это наша кухня: клиенту говорим «работа идёт» или «работа стоит».
    expect(body).not.toMatch(/COMPANY_STATUS_LABEL/);
  });
});

describe('проверка каналов связи', () => {
  const src = () => sourceWithoutComments('analytics/channel-check.scheduler.ts');

  it('проверяет чат, не отправляя в него ничего', () => {
    const s = src();
    expect(s).toMatch(/isChatAlive/);
    // Признак ошибки: «проверка» канала отправкой сообщения живым людям.
    expect(s).not.toMatch(/sendMessage\(company\.telegramWorkChatId/);
  });

  it('ловит отсутствие личной привязки у РОПа и владельца', () => {
    expect(src()).toMatch(/не подключил личный Telegram/);
  });

  it('результат проверки попадает в журнал компании', () => {
    expect(src()).toMatch(/CompanyEventType\.CHANNEL_CHECK/);
  });

  it('сетевой сбой не выдаётся за поломку канала', () => {
    // Иначе минутный сбой сети превращается в тревогу «клиент удалил бота», и на такие
    // тревоги перестают смотреть.
    const s = sourceWithoutComments('analytics/telegram.service.ts');
    const start = s.indexOf('async isChatAlive');
    const body = s.slice(start, start + 700);
    expect(body).toMatch(/catch[\s\S]{0,200}return true/);
  });
});

describe('переписку можно сдать текстом, а не только скриншотами', () => {
  it('пустую переписку отправить нельзя', () => {
    const s = sourceWithoutComments('entries/entries.service.ts');
    expect(s).toMatch(/Добавьте текст переписки или хотя бы один скриншот/);
  });

  it('аналитика берёт вставленный текст переписки, а не только распознанный со скриншота', () => {
    const s = sourceWithoutComments('analytics/analytics.service.ts');
    expect(s).toMatch(/EntryType\.CHAT && entry\.transcription/);
  });
});
