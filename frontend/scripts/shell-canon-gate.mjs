import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const req = createRequire(import.meta.url);
const pkg = req.resolve('@chirkov/shell/package.json');
const gate = join(dirname(pkg), 'gate', 'оболочка-канон.mjs');
const r = spawnSync(process.execPath, [gate, '--конфиг', 'scripts/оболочка-канон.json'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
