import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'src/fonts');
const families = [
  { name: 'Inter', prefix: 'inter', subsets: ['cyrillic', 'latin'], weights: [400, 500, 600, 700] },
  { name: 'Oswald', prefix: 'oswald', subsets: ['cyrillic', 'latin'], weights: [500, 600, 700] },
];

for (const family of families) {
  const hashes = new Map();
  for (const subset of family.subsets) {
    for (const weight of family.weights) {
      const filename = `${family.prefix}-${subset}-${weight}-normal.woff2`;
      const bytes = await readFile(resolve(directory, filename));
      hashes.set(filename, createHash('sha256').update(bytes).digest('hex'));
    }
  }

  const uniqueHashes = new Set(hashes.values());
  if (uniqueHashes.size !== hashes.size) {
    const duplicates = [...hashes.entries()]
      .filter(([, hash], index, entries) => entries.findIndex(([, candidate]) => candidate === hash) !== index)
      .map(([filename, hash]) => `${filename}: ${hash}`);
    console.error(`${family.name}: разные начертания содержат одинаковые бинарники:\n${duplicates.join('\n')}`);
    process.exit(1);
  }

  console.log(`${family.name}: ${hashes.size} файлов, ${uniqueHashes.size} разных SHA-256 (${directory}).`);
}
