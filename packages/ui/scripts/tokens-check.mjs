import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp(resolve(tmpdir(), 'chip-shell-tokens-'));

try {
  const result = spawnSync(process.execPath, ['scripts/tokens-build.mjs', 'tokens/figma.json', temp], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  for (const file of ['tokens.css', 'theme.css']) {
    const [expected, actual] = await Promise.all([
      readFile(resolve(temp, file)),
      readFile(resolve(root, 'src', file)),
    ]);
    if (!expected.equals(actual)) {
      console.error(`${file}: ручная правка или устаревшая сборка; запустите npm run tokens:build`);
      process.exit(1);
    }
  }
  console.log('Токены: tokens.css и theme.css побайтно совпадают с tokens/figma.json.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
