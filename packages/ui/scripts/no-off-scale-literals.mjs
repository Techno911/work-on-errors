import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowedFontSizes = new Set([12, 13, 15, 18, 22, 26, 44]);
const allowedPixelHeights = new Set([32, 44]);
const legacyCategoryColors = new Set([
  '#EF4444', '#F59E0B', '#F97316', '#8B5CF6',
  '#EC4899', '#06B6D4', '#10B981', '#6366F1',
]);
const findings = [];
const lockedVisualComponents = new Set([
  'Avatar.tsx', 'Badge.tsx', 'Button.tsx', 'Chip.tsx', 'Choice.tsx', 'Dropdown.tsx', 'EmptyState.tsx',
  'DateField.tsx', 'Field.tsx', 'FileField.tsx', 'Input.tsx', 'ListRow.tsx', 'Modal.tsx', 'NavItem.tsx',
  'Notice.tsx', 'ProgressBar.tsx', 'Select.tsx', 'SidebarToggle.tsx', 'Switch.tsx',
  'Table.tsx', 'Tabs.tsx', 'Textarea.tsx', 'Toaster.tsx', 'Tooltip.tsx', 'TopBar.tsx',
  'UserBlock.tsx',
]);
let inspectedFiles = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (['.css', '.ts', '.tsx'].includes(extname(entry.name))) await inspect(path);
  }
}

async function inspect(path) {
  inspectedFiles += 1;
  const source = await readFile(path, 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      if (!allowedFontSizes.has(Number(match[1]))) findings.push(`${path}:${index + 1}: кегль ${match[1]}px вне шкалы`);
    }
    for (const match of line.matchAll(/(?:^|[;{\s])(?:min-|max-)?height\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      if (!allowedPixelHeights.has(Number(match[1]))) findings.push(`${path}:${index + 1}: высота ${match[1]}px вне шкалы контролов`);
    }
    if (/\.(?:tsx?|jsx?)$/.test(path)) {
      const colorLiterals = [...line.matchAll(/#[0-9a-f]{3,8}\b|rgba?\s*\(/gi)].map(([value]) => value.toUpperCase());
      const onlyLegacyCategoryAliases = path.endsWith('/categoryColor.ts')
        && colorLiterals.every((value) => legacyCategoryColors.has(value));
      if (colorLiterals.length && !onlyLegacyCategoryAliases) {
        findings.push(`${path}:${index + 1}: цвет задан в компоненте литералом`);
      }
      if (/['"`]\s*\d+(?:\.\d+)?px\s*['"`]/.test(line)) {
        findings.push(`${path}:${index + 1}: размер задан в компоненте литералом`);
      }
    }
  });

  const fileName = path.split('/').at(-1);
  if (lockedVisualComponents.has(fileName)) {
    if (/\bclassName\s*\?\s*:/.test(source)) findings.push(`${path}: визуальный примитив принимает className`);
    if (/\bstyle\s*\?\s*:/.test(source)) findings.push(`${path}: визуальный примитив принимает style`);
  }
}

await walk(root);
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log(`Литералы и API визуальных примитивов: ${inspectedFiles} файлов, шкала соблюдена.`);
