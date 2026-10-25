/**
 * Крошечный репозиторий в памяти для замков вокруг StaffNotifierService.
 *
 * Нужен потому, что решение «сказать человеку или промолчать» зависит от СОСТОЯНИЯ между
 * прогонами: вчера уже говорили — сегодня молчим. Проверить это моком одного вызова нельзя,
 * нужен носитель, переживающий два прогона в одном тесте.
 *
 * Умеет ровно то, что спрашивает у него нотификатор: find по одному полю, findOne, create,
 * save (в том числе массивом), remove. Больше уметь не должен: лишние возможности в тестовой
 * заглушке начинают расходиться с TypeORM и врать в обе стороны.
 */
export class InMemoryRepo<T extends Record<string, unknown>> {
  rows: T[] = [];

  constructor(private readonly primaryKeys: string[]) {}

  create(obj: Partial<T>): T {
    return { ...(obj as T) };
  }

  async find(opts?: { where?: Partial<T> }): Promise<T[]> {
    const where = opts?.where;
    if (!where) return [...this.rows];
    return this.rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  }

  async findOne(opts: { where: Partial<T> }): Promise<T | null> {
    const found = await this.find(opts);
    return found[0] ?? null;
  }

  async save(input: T | T[]): Promise<T | T[]> {
    const list = Array.isArray(input) ? input : [input];
    for (const row of list) {
      const idx = this.rows.findIndex((r) => this.primaryKeys.every((k) => r[k] === row[k]));
      if (idx >= 0) this.rows[idx] = row;
      else this.rows.push(row);
    }
    return input;
  }

  async remove(rows: T[]): Promise<T[]> {
    for (const row of rows) {
      const idx = this.rows.findIndex((r) => this.primaryKeys.every((k) => r[k] === row[k]));
      if (idx >= 0) this.rows.splice(idx, 1);
    }
    return rows;
  }
}
