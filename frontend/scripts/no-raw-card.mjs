#!/usr/bin/env node
/** Every JSX className is measured. Unknown classes block outside the UI component home. No debt snapshot. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts, appCn, parse, traverse, isOpening, tag, hasRole, canonicalRoot, unresolvedClassesForbidden, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const ROLES = new Set(['readonly-value', 'selection-preview', 'selected-file', 'disabled-choice-row',
  'media-slot', 'file-dropzone', 'chat-choice-row', 'attached-editor-footer', 'password-value']);
const CARD_TAGS = new Set(['Card', 'CardTitle', 'CardDescription']);

function hasCardRecipe(value) {
  const tokens = appCn(value).split(/\s+/);
  return tokens.some(t => /(?:^|:)bg-(?:white|surface|surface-raised|surface-canvas)(?:\/\d+)?$/.test(t))
    && tokens.some(t => /(?:^|:)rounded-(?:lg|xl|2xl|3xl|card|nested|\(--radius-card\)|\[\d+px\])$/.test(t))
    && tokens.some(t => /(?:^|:)border(?:$|-(?:[1248]|\[(?:[1-9]\d*)px\])$)/.test(t));
}

export function scanSource(source, filename = 'fixture.tsx') {
  const { sf, classes, line } = parse(source, filename);
  const hits = [];
  traverse(sf, node => {
    if (!isOpening(node)) return;
    if (CARD_TAGS.has(tag(node)) || ['code', 'Link'].includes(tag(node))) return;
    if (tag(node) === 'div' && hasRole(node, ROLES)) return;
    if (tag(node) === 'span' && hasRole(node, new Set(['password-value']))) return;
    if (tag(node) === 'Button' && hasRole(node, new Set(['choice-row']))) return;
    if (canonicalRoot(node, filename, 'components/ui/card.tsx', [...CARD_TAGS])) return;
    const resolved = classes(node);
    const recipe = resolved.values.find(hasCardRecipe);
    if (recipe) hits.push({ line: line(node), kind: 'raw-card', detail: `<${tag(node)}> ${recipe}` });
    // One location, one diagnosis. A known raw card already blocks even with unknown suffixes.
    else if (resolved.dynamic && unresolvedClassesForbidden(filename)) hits.push({ line: line(node), kind: 'unresolved-class', detail: resolved.detail });
  });
  for (const diagnostic of sf.parseDiagnostics) hits.push({ line: 1, kind: 'parse-error', detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  return hits;
}

function selftest() {
  const card = 'bg-surface-canvas rounded-nested p-4 border border-border';
  const cases = [
    { label: 'canvas из описи / JSX', source: `<div className="${card}" />`, expected: ['raw-card'] },
    { label: 'p из CompanyDetailPage', source: `<p className="${card}">Текст</p>`, expected: ['raw-card'] },
    { label: 'atRisk из RopBonusCard', source: '<div className={`rounded-nested px-4 py-3 ${atRisk ? "bg-danger-subtle border border-danger-subtle" : "bg-surface-canvas border border-border"}`} />', expected: ['raw-card'] },
    { label: 'cn / обе части на одном узле', source: `const a = <div className={cn('bg-surface-raised rounded-card', bad ? 'border border-danger-muted' : 'border border-border')} />`, expected: ['raw-card'] },
    { label: 'content marker', source: '<div className={`content-["marker"] bg-white rounded-2xl border border-border p-6`} />', expected: ['raw-card'] },
    { label: 'Card и разнесённые классы', source: `<Card className={runtime}><div className="bg-surface-canvas" /><div className="rounded-nested border" /></Card>`, expected: 0 },
    { label: 'border-0 не является рамкой / StreakBadge', source: '<Badge className="bg-surface-canvas rounded-nested border-0"/>', expected: 0 },
    { label: 'цвет рамки без ширины', source: '<div className="bg-surface-canvas rounded-nested border-border"/>', expected: 0 },
    { label: 'кнопка выбора с ролью', source: `<Button data-ui-role="choice-row" className="${card}"/>`, expected: 0 },
    { label: 'кнопка выбора не скрывает ребёнка', source: `<Button data-ui-role="choice-row" className="${card}"><div className="${card}"/></Button>`, expected: ['raw-card'] },
    { label: 'Link и code', source: `<><Link className="${card}" /><code className="${card}" /></>`, expected: 0 },
    { label: 'роль не прячет ребёнка', source: `<div data-ui-role="file-dropzone" className="${card}"><div className="${card}" /></div>`, expected: ['raw-card'] },
    { label: 'роль не прячет соседа', source: `<><div data-ui-role="readonly-value" className="${card}" /><div className="${card}" /></>`, expected: ['raw-card'] },
    { label: 'произвольная роль не исключение', source: `<div data-ui-role="anything" className="${card}" />`, expected: ['raw-card'] },
    { label: 'значение пароля является span', source: `<span data-ui-role="password-value" className="${card}"/>`, expected: 0 },
    { label: 'роль div не разрешает произвольный span', source: `<span data-ui-role="readonly-value" className="${card}"/>`, expected: ['raw-card'] },
    { label: 'перезапись роли spread', source: `<div data-ui-role="file-dropzone" {...props} className="${card}" />`, expected: ['raw-card'] },
    { label: 'канон не исключает файл', filename: 'components/ui/card.tsx', source: `export function Card(){return <div className={unknown}/>}; export function Rogue(){return <div className="${card}"/>}`, expected: ['raw-card'] },
    { label: 'динамика блокирует', source: '<div className={externalClasses}/>', expected: ['unresolved-class'] },
    ...['components/ui/Fixture.tsx', 'components/ui/nested/Fixture.jsx', 'components/ui/button.tsx'].flatMap(filename => [
      { label: `сырой рецепт в доме ${filename}`, filename, source: `<div className="${card}"/>`, expected: ['raw-card'] },
      { label: `сырой рецепт с динамикой в доме ${filename}`, filename, source: `<div className={cn('${card}', className)}/>`, expected: ['raw-card'] },
      { label: `динамическая сборка в доме ${filename}`, filename, source: 'function Surface({className}){return <div className={cn("flex", className)}/>} ', expected: 0 },
      { label: `spread в доме ${filename}`, filename, source: '<div {...props}/>', expected: 0 },
      { label: `законный компонент в доме ${filename}`, filename, source: '<Card className={className}/>', expected: 0 },
    ]),
    ...['components/Fixture.tsx', 'components/ui-extra/Fixture.tsx', 'components/admin/ui/Fixture.tsx', 'components/ui/../forms/Fixture.tsx', 'pages/Fixture.tsx'].map(filename => (
      { label: `динамика вне дома ${filename}`, filename, source: 'function Surface({className}){return <div className={cn("flex", className)}/>} ', expected: ['unresolved-class'] }
    )),
    { label: 'скрытые в spread классы блокируют', source: '<div {...props}/>', expected: ['unresolved-class'] },
    { label: 'лексическая область', source: 'const x="flex"; function F({x}){return <div className={x}/>}', expected: ['unresolved-class'] },
    { label: 'класс из словаря', source: `const m={bad:"${card}", good:"flex"}; <div className={m[state]}/>`, expected: ['raw-card'] },
    { label: 'объект clsx комбинируется', source: `<div className={clsx({'bg-surface-canvas': a, 'rounded-card': b, border: c})}/>`, expected: ['raw-card'] },
    { label: 'отключённый рецепт clsx', source: `<div className={clsx({'${card}': false})}/>`, expected: 0 },
    { label: 'точная конкатенация', source: '<div className={"bg-surface-" + "canvas rounded-card border"}/>', expected: ['raw-card'] },
    { label: 'переполнение не зелёное', source: '<div className={cn(' + Array.from({length:10}, (_,i) => `x${i} ? "m-${i}" : "p-${i}"`).join(',') + ')}/>', expected: ['unresolved-class'] },
    ...[...ROLES].map(role => ({ label: `роль ${role}`, source: `<div data-ui-role="${role}" className="${card}"/>`, expected: 0 })),
  ];
  return assertSamples('no-raw-card', scanSource, cases);
}
const tests = selftest();
if (process.argv.includes('--selftest')) console.log(`✓ no-raw-card: ${tests} самопроверок; слом пойман, законные образцы приняты`);
else {
  const root = process.argv.slice(2).find(a => !a.startsWith('--')) || ROOT;
  process.exitCode = report('no-raw-card', inspectTree(root, scanSource));
}
