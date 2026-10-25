import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Замок на тип колонок-ссылок (разбор 09.08.2026).
 *
 * Класс дефекта дважды ломал прод: при synchronize: false фактический тип задаёт только ручная
 * миграция, и колонка-ссылка заводилась строкой, тогда как на другой стороне uuid. Пока по ней
 * нет ни одной связи, всё работает; первый же join падает в рантайме
 * «operator does not exist: uuid = character varying». Это не ловится ни типами, ни тестами,
 * ни health-check: только живым запросом со связью.
 *
 * Замок обходит ВСЕ сущности проекта и требует явный uuid у полей, которые ссылаются на
 * идентификатор другой сущности. Исключения перечислены поимённо с причиной: молчаливое
 * исключение это и есть тот способ, которым дефект возвращается.
 */

const SRC = join(__dirname, '..');

/** Поля, которые по имени выглядят ссылкой на идентификатор. */
const LOOKS_LIKE_REF = /^(company|user|entry|sprint|manager|reviewer|owner|author|card|test|attempt|quiz|tag)Id$|_id$/i;

/** Ссылка, которой ПОЛОЖЕНО быть строкой, и почему. */
const ALLOWED_STRING: Record<string, string> = {
  'attestation-attempt.entity.ts:createdBy':
    'спецзначение system: аттестацию может назначить сама платформа, а не человек',
  'telegram-contact.entity.ts:chatId':
    'внешний идентификатор чата Telegram вида -1001234567, к нашим сущностям отношения не имеет',
  'company.entity.ts:telegramWorkChatId':
    'тот же внешний идентификатор чата Telegram, а не ссылка на запись в базе',
};

function entityFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...entityFiles(full));
    else if (name.endsWith('.entity.ts')) out.push(full);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

describe('колонки-ссылки объявлены как uuid', () => {
  it('ни одно поле-ссылка не заведено строкой', () => {
    const offenders: string[] = [];

    for (const file of entityFiles(SRC)) {
      const short = file.split('/').pop() as string;
      const code = stripComments(readFileSync(file, 'utf8'));

      // Пара «декоратор + объявление поля» может стоять и на одной строке, и на двух.
      const declRe = /@Column\(([^)]*)\)\s*([a-zA-Z_]\w*)!?\s*:\s*([^;]+);/g;
      let m: RegExpExecArray | null;
      while ((m = declRe.exec(code)) !== null) {
        const [, options, field, tsType] = m;
        // Имя колонки может отличаться от имени поля: смотрим и то, и другое.
        const nameInOptions = /name:\s*'([^']+)'/.exec(options)?.[1] ?? '';
        const isRef = LOOKS_LIKE_REF.test(field) || LOOKS_LIKE_REF.test(nameInOptions);
        if (!isRef) continue;
        if (!/string/.test(tsType)) continue; // не строковое поле нас не интересует
        if (ALLOWED_STRING[`${short}:${field}`]) continue;

        if (!/type:\s*'uuid'/.test(options)) {
          offenders.push(`${short}: ${field}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('каждое исключение всё ещё существует в коде', () => {
    const all = entityFiles(SRC).map((f) => ({
      short: f.split('/').pop() as string,
      code: readFileSync(f, 'utf8'),
    }));
    for (const key of Object.keys(ALLOWED_STRING)) {
      const [file, field] = key.split(':');
      const found = all.find((f) => f.short === file);
      expect(`${key}: файл найден`).toBe(`${key}: ${found ? 'файл найден' : 'файла нет'}`);
      expect(`${key}: поле на месте`).toBe(
        `${key}: ${found && found.code.includes(field) ? 'поле на месте' : 'поля нет'}`,
      );
    }
  });

  it('миграция типов существует и перечисляет ровно то, что починено', () => {
    const sql = readFileSync(join(SRC, '..', '..', 'scripts', 'sql', 'v8.0.5-uuid-columns.sql'), 'utf8');
    const pairs = [
      ["'entries'", "'companyId'"],
      ["'error_tags'", "'companyId'"],
      ["'playbook_cards'", "'companyId'"],
      ["'playbook_cards'", "'ownerId'"],
      ["'review_templates'", "'companyId'"],
      ["'transcription_usage'", "'companyId'"],
      ["'attestation_tests'", "'companyId'"],
      ["'crm_connections'", "'company_id'"],
      ["'achievements'", "'userId'"],
      ["'xp_transactions'", "'userId'"],
      ["'xp_transactions'", "'entryId'"],
    ];
    for (const [tbl, col] of pairs) {
      expect(sql).toContain(`(${tbl},`);
      expect(sql).toContain(col);
    }
    // Защита от порчи данных должна остаться: миграция обязана падать на неконвертируемом.
    expect(sql).toMatch(/RAISE EXCEPTION/);
  });
});
