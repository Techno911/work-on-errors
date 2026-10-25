#!/usr/bin/env node
/** Absolute raw-button prohibition. No baseline and no refresh mode. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts, parse, traverse, isOpening, tag, canonicalRoot, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
export function scanSource(source, filename = 'fixture.tsx') {
  const { sf, line } = parse(source, filename);
  const hits = [];
  traverse(sf, node => {
    if (isOpening(node) && tag(node) === 'button'
      && !canonicalRoot(node, filename, 'components/ui/button.tsx', ['Button'])) {
      hits.push({ line: line(node), kind: 'raw-button', detail: 'сырой <button>; используйте <Button> из @/components/ui/button' });
    }
  });
  for (const diagnostic of sf.parseDiagnostics) hits.push({ line: 1, kind: 'parse-error', detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  return hits;
}
function selftest() {
  return assertSamples('no-raw-button', scanSource, [
    { label: 'обычный и многострочный button / JSX', source: '<><button className="px-4 py-2">Сохранить</button><button\n onClick={go}>Отправить</button></>', expected: ['raw-button', 'raw-button'] },
    { label: 'канон / строки / комментарии', source: '// было <button>\nconst buttonLabel="<button>"; <Button>{buttonLabel}</Button>', expected: 0 },
    { label: 'канонический файл не пропускается', filename: 'components/ui/button.tsx', source: 'export const Button=forwardRef((props,ref)=><button {...props} ref={ref}/>); function Other(){return <button/>}', expected: ['raw-button'] },
    { label: 'роль не разрешает кнопку', source: '<button data-ui-role="anything"/>', expected: ['raw-button'] },
    { label: 'имя в чужом файле не исключение', source: 'function Button(){return <button/>}', expected: ['raw-button'] },
    ...['components/ui/Fixture.tsx', 'components/ui/nested/Fixture.jsx', 'components/ui/card.tsx'].flatMap(filename => [
      { label: `сырая кнопка в доме ${filename}`, filename, source: 'function Button(){return <button className={className}/>}', expected: ['raw-button'] },
      { label: `законная кнопка в доме ${filename}`, filename, source: '<Button className={className}/>', expected: 0 },
    ]),
    { label: 'законная реализация Button', filename: 'components/ui/button.tsx', source: 'export const Button=forwardRef((props,ref)=><button {...props} ref={ref}/>);', expected: 0 },
  ]);
}
const tests = selftest();
if (process.argv.includes('--refresh') || process.argv.includes('--обновить')) throw new Error('no-raw-button: снимки долга запрещены');
if (process.argv.includes('--selftest') || process.argv.includes('--самопроверка')) console.log(`✓ no-raw-button: ${tests} самопроверок; слом пойман, законные образцы приняты`);
else process.exitCode = report('no-raw-button', inspectTree(process.argv.slice(2).find(a => !a.startsWith('--')) || ROOT, scanSource));
