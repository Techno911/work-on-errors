import { cp, copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/fonts', { recursive: true });
for (const file of ['tokens.css', 'fonts.css', 'styles.css', 'theme.css']) {
  await copyFile(`src/${file}`, `dist/${file}`);
}
await cp('src/fonts', 'dist/fonts', { recursive: true });
