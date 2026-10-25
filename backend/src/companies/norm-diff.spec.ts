import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { diffNorms, describeNormChanges, NORM_FIELDS } from './norm-diff';
import { NORM_PRESETS } from './norm-presets';

/**
 * Замок смены планки команды (24.08.2026).
 *
 * Повод: клиент спросил, почему у менеджеров стало 8 разборов в неделю вместо 5, и ответить
 * было нечем. Нормативы меняются из двух мест, и ни одно не оставляло следа в журнале.
 *
 * Проверяется две вещи: сравнение честно называет изменение (и молчит, когда его нет), и
 * НИ ОДНА поверхность записи нормативов не может появиться в будущем без записи в журнал.
 * Второе важнее: одна забытая поверхность возвращает нас ровно в исходную точку.
 */
describe('diffNorms', () => {
  it('видит смену числа разборов и называет старое значение', () => {
    const changes = diffNorms({ callsPerWeek: 5 }, { callsPerWeek: 8 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: 'callsPerWeek', from: 5, to: 8 });
    expect(describeNormChanges(changes)).toBe('звонков в неделю: 5 → 8');
  });

  it('молчит, когда владелец сохранил настройки, ничего не тронув', () => {
    const same = { callsPerWeek: 5, chatsPerWeek: 5, minReviewChars: 150 };
    expect(diffNorms(same, { ...same })).toHaveLength(0);
  });

  it('не считает изменением поле, которого нет в новом состоянии', () => {
    // Владелец правит соседнюю вкладку и шлёт частичный набор: «стало не задано» это выдумка.
    expect(diffNorms({ callsPerWeek: 5, chatsPerWeek: 5 }, { chatsPerWeek: 5 })).toHaveLength(0);
  });

  it('впервые заданный норматив показывает честно, а не как «было ноль»', () => {
    const changes = diffNorms({}, { minSelfReviewSuggestionsChars: 100 });
    expect(describeNormChanges(changes)).toBe('самоанализ «конкретные предложения», знаков: не задано → 100');
  });

  it('достаёт вложенные нормативы руководителя из reviewNorms', () => {
    const changes = diffNorms(
      { reviewNorms: { minReviewsPerWeek: 5, maxHoursToRespond: 24 } },
      { reviewNorms: { minReviewsPerWeek: 10, maxHoursToRespond: 24 } },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toBe('reviewNorms.minReviewsPerWeek');
  });

  it('на переходе со стандартного режима на жёсткий видит весь пакет, а не одно число', () => {
    // Ровно случай одного клиента: клиент заметил «8 вместо 5», а поменялось куда больше.
    const changes = diffNorms(NORM_PRESETS.standard.data, NORM_PRESETS.strict.data);
    const keys = changes.map(c => c.key);
    expect(keys).toContain('callsPerWeek');
    expect(keys).toContain('minSelfReviewSuggestionsChars');
    expect(keys).toContain('reviewNorms.minReviewsPerWeek');
    expect(changes.length).toBeGreaterThanOrEqual(10);
  });
});

/** Поля нормативов в виде, в котором они встречаются в коде присвоением. */
const NORM_KEYS = NORM_FIELDS.map(f => f.key.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i);

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectTsFiles(full, acc);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('журнал нормативов покрывает поверхность, а не два известных файла', () => {
  const SRC = join(__dirname, '..');
  // Справочники и описания схемы значения не пишут, они его объявляют.
  const DECLARATIONS = ['norm-presets.ts', 'norm-diff.ts', 'company.entity.ts', 'create-company.dto.ts'];

  it('каждый файл, который пишет нормативы компании, зовёт logNormsChange', () => {
    const guilty: string[] = [];
    for (const file of collectTsFiles(SRC)) {
      if (DECLARATIONS.some(d => file.endsWith(d))) continue;
      const code = readFileSync(file, 'utf8');
      const writesWholeCompany = /Object\.assign\(\s*company\s*,/.test(code);
      const writesField = NORM_KEYS.some(k => new RegExp(`company\\.${k}\\s*=[^=]`).test(code));
      if (!writesWholeCompany && !writesField) continue;
      if (!/\.logNormsChange\(/.test(code)) guilty.push(file.replace(SRC, 'src'));
    }
    expect(guilty).toEqual([]);
  });

  it('обе известные поверхности действительно найдены обходом (иначе проверка слепа)', () => {
    const found = collectTsFiles(SRC).filter(f => /\.logNormsChange\(/.test(readFileSync(f, 'utf8')));
    const names = found.map(f => f.split('/').pop());
    expect(names).toContain('admin.service.ts');
    expect(names).toContain('companies.service.ts');
  });
});
