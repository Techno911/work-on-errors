import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const subsets = ['cyrillic', 'latin'] as const;
const families = [
  { name: 'Inter', prefix: 'inter', weights: [400, 500, 600, 700] },
  { name: 'Oswald', prefix: 'oswald', weights: [500, 600, 700] },
] as const;

describe('локальные шрифты пакета', () => {
  for (const family of families) {
    it(`${family.name}: разные бинарники для каждого веса и набора символов`, () => {
      const hashes = subsets.flatMap((subset) =>
        family.weights.map((weight) => {
          const filename = `${family.prefix}-${subset}-${weight}-normal.woff2`;
          const bytes = readFileSync(resolve(process.cwd(), 'src/fonts', filename));
          return createHash('sha256').update(bytes).digest('hex');
        }),
      );

      expect(new Set(hashes).size).toBe(hashes.length);
    });
  }
});
