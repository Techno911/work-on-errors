import { AccessMember, buildAccessBlock, findMessageDefects, LAUNCH_MESSAGE_DEFAULT, PLATFORM_URL } from './launch-message';

/**
 * Гейт стартового сообщения команде. Сообщение склеивается из двух кусков (черновик + хвост
 * с доступами), и дефекты живут ровно на стыке: каждый кусок по отдельности выглядит нормально.
 * поймано на проде ссылку на платформу дважды в одном сообщении — тест держит планку,
 * чтобы это не вернулось при следующей правке любого из кусков.
 */

const TEAM: AccessMember[] = [
  { fullName: 'Менеджер Первый', email: 'manager1@example.invalid', roleLabel: 'менеджер', hasLoggedIn: false },
  { fullName: 'Роп Образцов', email: 'rop@example.invalid', roleLabel: 'РОП', hasLoggedIn: false },
  { fullName: 'Владелец Демо', email: 'owner@example.invalid', roleLabel: 'владелец', hasLoggedIn: true },
];

const fullMessage = (mode: 'send' | 'preview') => LAUNCH_MESSAGE_DEFAULT + buildAccessBlock(TEAM, mode);

describe('стартовое сообщение команде', () => {
  it('уходит в чат без дублей: ни ссылки, ни строки не повторяются', () => {
    expect(findMessageDefects(fullMessage('send'))).toEqual([]);
  });

  it('превью трекеру такое же чистое, как отправка', () => {
    expect(findMessageDefects(fullMessage('preview'))).toEqual([]);
  });

  it('общая ссылка входа в сообщении ровно одна (именные ссылки не считаются)', () => {
    // Именные ссылки активации у каждого свои и содержат /activate/<токен>; общая ссылка
    // «просто зайти на платформу» должна оставаться единственной, ради чего тест и заведён.
    const escaped = PLATFORM_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const plain = (fullMessage('send').match(new RegExp(escaped + '(?!/activate)', 'g')) ?? []);
    expect(plain).toHaveLength(1);
  });

  it('превью не раскрывает ссылку входа, отправка кладёт именную ссылку', () => {
    const withLink: AccessMember[] = [{ ...TEAM[0], activationUrl: 'https://app.example.invalid/activate/abc123' }];
    expect(buildAccessBlock(withLink, 'preview')).not.toContain('abc123');
    expect(buildAccessBlock(withLink, 'send')).toContain('https://app.example.invalid/activate/abc123');
  });

  it('пароль в сообщении не рассылается вообще', () => {
    // Замок против возврата прежней конструкции: пароль в переписке живёт дольше, чем нужно,
    // и уходит через третьи руки. Слово «пароль» допустимо только в объяснении, что его
    // придумает сам человек, а поля password у участника больше нет.
    const withLink: AccessMember[] = [{ ...TEAM[0], activationUrl: 'https://app.example.invalid/activate/abc123' }];
    const block = buildAccessBlock(withLink, 'send');
    expect(block).not.toContain('<tg-spoiler>');
    expect(block).toContain('вы придумаете себе пароль');
  });

  it('когда вся команда уже входила, про ссылки не говорим вовсе', () => {
    // Случай перезапуска и повторного старта: ссылок никому не выдаётся, и объяснение
    // «придумайте пароль по своей ссылке» отправило бы людей искать то, чего в сообщении нет.
    // Поймано на живом клиента до отправки сообщения команде.
    const allIn: AccessMember[] = TEAM.map(m => ({ ...m, hasLoggedIn: true }));
    const block = buildAccessBlock(allIn, 'send');
    expect(block).not.toContain('придумаете себе пароль');
    expect(block).not.toContain('живёт 3 дня');
    expect(block).toContain('по вашей рабочей почте и паролю');
  });

  it('входивший помечен без ссылки, не входивший получает почту и ссылку', () => {
    const block = buildAccessBlock(TEAM, 'preview');
    expect(block).toContain('Владелец Демо (владелец): уже на платформе');
    expect(block).not.toContain('owner@example.invalid');
    expect(block).toContain('rop@example.invalid');
  });
});

describe('детектор дефектов', () => {
  it('ловит ту самую ошибку, ради которой заведён: ссылка дважды', () => {
    const broken = 'Платформа: https://app.example.invalid. Доступы ниже.\n\nВход: https://app.example.invalid. Пароль сменить в профиле.';
    expect(findMessageDefects(broken)).toEqual([expect.stringContaining('повторяется')]);
  });

  it('ловит дословно повторённую строку', () => {
    const broken = 'Загрузите первые звонки на платформу\nчто-то ещё\nЗагрузите первые звонки на платформу';
    expect(findMessageDefects(broken)).toEqual([expect.stringContaining('строка повторяется')]);
  });

  it('не придирается к чистому тексту', () => {
    expect(findMessageDefects('Коллеги, привет. Вход: https://app.example.invalid, пароль в профиле.')).toEqual([]);
  });
});
