#!/usr/bin/env node
/** Raw input/textarea are forbidden; only canonical roots and hidden file controls are legal. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts, appCn, parse, traverse, isOpening, tag, attribute, literalAttribute, enclosingComponent, canonicalRoot, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function hiddenFileControl(node, classes) {
  if (tag(node) !== 'input' || literalAttribute(node, 'type') !== 'file') return false;
  // type=file expresses the element's function, independent of file/component names.
  // It must handle selection inside a component and stay hidden in every class scenario.
  if (!enclosingComponent(node) || !attribute(node, 'onChange') || attribute(node, 'style')) return false;
  const resolved = classes(node);
  return !resolved.dynamic && resolved.values.length > 0 && resolved.values.every(value => {
    const tokens = appCn(value).split(/\s+/);
    const hidden = tokens.includes('hidden') && !tokens.some(t => /(?:^|:)!?(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|contents)(?:!)?$/.test(t));
    const srOnly = tokens.includes('sr-only') && !tokens.some(t => /(?:^|:)!?not-sr-only!?$/.test(t));
    return hidden || srOnly;
  });
}
export function scanSource(source, filename = 'fixture.tsx') {
  const { sf, classes, line } = parse(source, filename);
  const hits = [];
  traverse(sf, node => {
    if (!isOpening(node) || !['input', 'textarea'].includes(tag(node))) return;
    const name = tag(node) === 'input' ? 'Input' : 'Textarea';
    if (canonicalRoot(node, filename, 'components/ui/input.tsx', [name])) return;
    if (hiddenFileControl(node, classes)) return;
    hits.push({ line: line(node), kind: `raw-${tag(node)}`, detail: `<${tag(node)}> используйте <${name}>; file разрешён только скрытым обработчиком выбора внутри компонента` });
  });
  for (const diagnostic of sf.parseDiagnostics) hits.push({ line: 1, kind: 'parse-error', detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  return hits;
}
function selftest() {
  const cases = [
    { label: 'AddEntryForm / textarea / JSX', source: '<textarea className="w-full px-3 py-2 border border-border-strong rounded-control text-dense"/>', expected: ['raw-textarea'] },
    { label: 'сырое поле с переносом', source: '<input\n type="text" className="border rounded-control"/>', expected: ['raw-input'] },
    { label: 'канонические теги и комментарии', source: '// <input/>\nconst text="<textarea/>"; <><Input/><Textarea/></>', expected: 0 },
    { label: 'видимый системный file', source: 'function Upload(){return <input type="file" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'hidden / настоящий файловый компонент', source: 'function Upload(){return <input type="file" className="hidden" onChange={pick}/>}', expected: 0 },
    { label: 'sr-only / файловый компонент', source: 'const Upload=()=> <input type={"file"} className={cn("sr-only")} onChange={pick}/>', expected: 0 },
    { label: 'скрытый text не исключение', source: 'function Upload(){return <input type="text" className="hidden" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'роль не разрешает видимый file', source: 'function Upload(){return <input type="file" data-ui-role="file-dropzone" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'динамический тип не исключение', source: 'function Upload(){return <input type={kind} className="hidden" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'условное скрытие не исключение', source: 'function Upload(){return <input type="file" className={hide ? "hidden" : "block"} onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'breakpoint раскрывает file', source: 'function Upload(){return <input type="file" className="hidden md:block" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'style раскрывает file', source: 'function Upload(){return <input type="file" className="hidden" style={{display:"block"}} onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'important раскрывает file', source: 'function Upload(){return <input type="file" className="hidden md:!block" onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'spread может раскрыть поле', source: 'function Upload(){return <input type="file" className="hidden" {...props} onChange={pick}/>}', expected: ['raw-input'] },
    { label: 'канон не пропускает файл', filename: 'components/ui/input.tsx', source: 'export const Input=forwardRef((props,ref)=><input {...props} ref={ref}/>); export const Textarea=forwardRef((props,ref)=><textarea {...props} ref={ref}/>); function Other(){return <input/>}', expected: ['raw-input'] },
    { label: 'имя компонента в другом файле не исключение', source: 'export function Input(){return <input/>}', expected: ['raw-input'] },
    { label: 'скрытый file не прячет соседа', source: 'function Upload(){return <><input type="file" className="hidden" onChange={pick}/><input/></>}', expected: ['raw-input'] },
    ...['components/ui/Fixture.tsx', 'components/ui/nested/Fixture.jsx', 'components/ui/card.tsx'].flatMap(filename => [
      { label: `сырые поля в доме ${filename}`, filename, source: 'function Input(){return <input className={className}/>}; function Textarea(){return <textarea className={className}/>}', expected: ['raw-input', 'raw-textarea'] },
      { label: `законные поля в доме ${filename}`, filename, source: '<><Input className={className}/><Textarea className={className}/></>', expected: 0 },
      { label: `динамика не легализует file в доме ${filename}`, filename, source: 'function Upload(){return <input type="file" className={cn("hidden", className)} onChange={pick}/>}', expected: ['raw-input'] },
    ]),
    { label: 'законные реализации полей', filename: 'components/ui/input.tsx', source: 'export const Input=forwardRef((props,ref)=><input {...props} ref={ref}/>); export const Textarea=forwardRef((props,ref)=><textarea {...props} ref={ref}/>);', expected: 0 },
  ];
  return assertSamples('no-raw-input', scanSource, cases);
}
const tests = selftest();
if (process.argv.includes('--selftest')) console.log(`✓ no-raw-input: ${tests} самопроверок; слом пойман, законные образцы приняты`);
else process.exitCode = report('no-raw-input', inspectTree(process.argv.slice(2).find(a => !a.startsWith('--')) || ROOT, scanSource));
