import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), 'chip-shell-react-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} завершилась с кодом ${result.status}`);
  }
  return result.stdout.trim();
}

try {
  // prepack (сборка и замер 360/390) печатает в stdout и ломает разбор JSON; к этому шагу check уже собрал dist.
  const packJson = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], root));
  const tarball = join(temp, packJson[0].filename);
  for (const major of [18, 19]) {
    const fixture = join(temp, `react-${major}`);
    run('mkdir', ['-p', fixture], temp);
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2));
    await writeFile(join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/src.jsx"></script>');
    await writeFile(
      join(fixture, 'src.jsx'),
      `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { Button } from '@chirkov/shell';\nimport '@chirkov/shell/styles.css';\ncreateRoot(document.getElementById('root')).render(<Button>React ${major}</Button>);\n`,
    );
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `react@${major}`, `react-dom@${major}`, 'vite@7', '@vitejs/plugin-react@4', tarball], fixture);
    run('npx', ['vite', 'build'], fixture);
    const html = await readFile(join(fixture, 'dist/index.html'), 'utf8');
    if (!html.includes('script')) throw new Error(`React ${major}: сборка не содержит скрипт`);
    console.log(`React ${major}: consumer build OK`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
