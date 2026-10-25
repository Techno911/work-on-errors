#!/usr/bin/env node
/** Inline badges across src plus the independent exported-wrapper contract. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { ts, appCn, parse, traverse, isOpening, tag, hasRole, canonicalRoot, unresolvedClassesForbidden, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const ROLES = new Set(['icon-counter', 'position-indicator']);
const WRAPPER_ROLES = new Set(['achievement-card', 'transcription-status-panel']);
const COMPONENT_NAME = /(Badge|Pill|Chip)/;
const SMALL = /(?:^|:)text-(?:caption|xs|dense)(?:\/[^ ]+)?$/;
const FONT_SIZE = /(?:^|:)text-(?:caption|xs|dense|sm|base|lg|xl|[2-9]xl|h[1-6]|body|display|\[\d+(?:px|rem)\])(?:\/[^ ]+)?$/;

// tone is a data boundary, never a second palette API. Exclude<string, `var(...)`>
// is still string: both API data and widened palette constants have that type.
// Follow symbol declarations (including imports in the tree check), so moving a
// palette expression into a config, helper, alias or JSX spread cannot hide it.
function paletteInTone(sf, checker) {
  const hits = [];
  const palette = /--color-/;
  const writesByFile = new Map();
  function writes(sourceFile, symbol) {
    if (!writesByFile.has(sourceFile)) {
      const map = new Map();
      traverse(sourceFile, node => {
        if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
        let target = node.left;
        while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression;
        if (!ts.isIdentifier(target)) return;
        const key = checker.getSymbolAtLocation(target);
        map.set(key, [...(map.get(key) ?? []), node.right]);
      });
      writesByFile.set(sourceFile, map);
    }
    return writesByFile.get(sourceFile).get(symbol) ?? [];
  }
  // Значение под конкретным именем поля объекта-литерала (а не весь объект):
  // конфиги вида {tone:'accent', dotColor:'var(--color-info)'} после миграции
  // на пакетный Badge стали обычным паттерном — сосед по объекту не должен
  // засорять след, оставленный доступом к ОДНОМУ полю.
  function propertyValues(base, name, seen) {
    const prop = base.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && p.name.getText().replace(/['"]/g, '') === name);
    if (!prop) return [];
    return [ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer];
  }
  function objects(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return objects(node.expression, seen);
    if (ts.isObjectLiteralExpression(node)) return [node];
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      return [...objects(node.left, seen), ...objects(node.right, seen)];
    }
    if (ts.isConditionalExpression(node)) return [...objects(node.whenTrue, seen), ...objects(node.whenFalse, seen)];
    if (ts.isIdentifier(node)) {
      let symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declarations = symbol?.declarations ?? [];
      const assigned = [...new Set(declarations.flatMap(d => writes(d.getSourceFile(), symbol)))];
      return [...assigned.flatMap(value => objects(value, seen)), ...declarations.flatMap(d => {
        if (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isParameter(d)) return objects(d.initializer, seen);
        if (ts.isBindingElement(d)) return objects(d.parent.parent.initializer, seen);
        return [];
      })];
    }
    if (ts.isPropertyAccessExpression(node)) {
      return objects(node.expression, seen).flatMap(base => propertyValues(base, node.name.text, seen).flatMap(v => objects(v, seen)));
    }
    if (ts.isElementAccessExpression(node)) {
      // индекс не статический — берём объединение значений по всем веткам объекта
      return objects(node.expression, seen).flatMap(base => base.properties.flatMap(p => {
        if (ts.isPropertyAssignment(p)) return objects(p.initializer, seen);
        if (ts.isShorthandPropertyAssignment(p)) return objects(p.name, seen);
        if (ts.isSpreadAssignment(p)) return objects(p.expression, seen);
        return [];
      }));
    }
    return [];
  }
  function strings(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isIdentifier(node)) {
      let symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declarations = symbol?.declarations ?? [];
      const assigned = [...new Set(declarations.flatMap(d => writes(d.getSourceFile(), symbol)))];
      return [...assigned.flatMap(value => strings(value, seen)), ...declarations.flatMap(d => {
        if (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isParameter(d)) return strings(d.initializer, seen);
        if (ts.isFunctionDeclaration(d)) return strings(d.body, seen);
        if (ts.isBindingElement(d)) return strings(d.parent.parent.initializer, seen);
        return [];
      })];
    }
    if (ts.isPropertyAccessExpression(node)) {
      const bases = objects(node.expression, seen);
      if (bases.length) return bases.flatMap(base => propertyValues(base, node.name.text, seen).flatMap(v => strings(v, seen)));
      return strings(node.expression, seen);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = strings(node.left, seen), right = strings(node.right, seen);
      return [...left, ...right, ...left.flatMap(a => right.map(b => a + b))];
    }
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text];
      for (const span of node.templateSpans) {
        const middle = strings(span.expression, seen);
        values = values.flatMap(a => (middle.length ? middle : ['']).map(b => a + b + span.literal.text));
      }
      return values;
    }
    const values = [];
    ts.forEachChild(node, child => { values.push(...strings(child, seen)); });
    return values;
  }
  traverse(sf, node => {
    const property = (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(sf).replace(/['"]/g, '') === 'tone';
    const attribute = ts.isJsxAttribute(node) && node.name.getText(sf) === 'tone';
    if (!property && !attribute) return;
    const expression = ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer;
    const roles = [...new Set(strings(expression).filter(value => palette.test(value)))];
    if (roles.length) hits.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind: 'palette-through-tone',
      detail: `tone принимает цвет из данных; роль палитры должна идти через variant/color: ${roles.join(' | ')}`,
    });
  });
  return hits;
}

function toneProject(root) {
  const program = ts.createProgram(ts.sys.readDirectory(root, ['.ts', '.tsx', '.js', '.jsx']), {
    allowJs: true, jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, baseUrl: path.dirname(root), paths: { '@/*': ['src/*'] },
    noEmit: true, skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  return (source, filename) => scanSource(source, filename, {
    sf: program.getSourceFile(path.join(root, filename)), checker,
  });
}

function exportedFunctions(sf) {
  const out = [];
  const exported = n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const n of sf.statements) {
    if (ts.isFunctionDeclaration(n) && exported(n) && n.name) out.push({ name: n.name.text, node: n });
    if (ts.isVariableStatement(n) && exported(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.push({ name: d.name.text, node: d.initializer });
      }
    }
  }
  return out;
}

function inheritsSmall(node, classes) {
  let parent = ts.isJsxOpeningElement(node) ? node.parent.parent : node.parent;
  while (parent) {
    if (ts.isJsxElement(parent)) {
      const opening = parent.openingElement;
      const values = classes(opening).values;
      const sizes = values.flatMap(v => appCn(v).split(/\s+/).filter(t => FONT_SIZE.test(t)));
      if (sizes.length) return sizes.some(t => SMALL.test(t));
      if (tag(opening) === 'Badge') return true;
    }
    parent = parent.parent;
  }
  return false;
}

export function scanSource(source, filename = 'fixture.tsx', toneContext) {
  const { sf, checker, classes, line } = parse(source, filename);
  const hits = paletteInTone(toneContext?.sf ?? sf, toneContext?.checker ?? checker);
  traverse(sf, node => {
    if (!isOpening(node) || !['span', 'div'].includes(tag(node))) return;
    if (hasRole(node, ROLES) || canonicalRoot(node, filename, 'components/ui/badge.tsx', ['Badge', 'ColorTagBadge'])) return;
    const resolved = classes(node);
    const recipe = resolved.values.find(value => {
      const tokens = appCn(value).split(/\s+/);
      const sizes = tokens.filter(t => FONT_SIZE.test(t));
      return tokens.some(t => /(?:^|:)rounded-(?:full|chip)$/.test(t))
        && tokens.some(t => /(?:^|:)px-(?:0\.5|1|1\.5|2|2\.5|3|3\.5|4|\[\d+(?:\.\d+)?px\])$/.test(t))
        && (sizes.length ? sizes.some(t => SMALL.test(t)) : inheritsSmall(node, classes));
    });
    if (recipe) hits.push({ line: line(node), kind: 'inline-badge', detail: `<${tag(node)}> ${recipe}` });
    else if (resolved.dynamic && unresolvedClassesForbidden(filename)) hits.push({ line: line(node), kind: 'unresolved-class', detail: resolved.detail });
  });
  const aliases = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const local = module === './badge' || module.endsWith('/ui/badge');
    const packaged = module === '@chirkov/shell';
    if (!local && !packaged) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        // Badge канонический из пакета ИЛИ из местного файла; ColorTagBadge — только
        // из местного: это единственный дом санкционированного исключения (данные-цвет).
        if (imported === 'Badge' || (local && imported === 'ColorTagBadge')) aliases.add(element.name.text);
      }
    }
  }
  for (const item of exportedFunctions(sf).filter(item => COMPONENT_NAME.test(item.name))) {
    if (filename === 'components/ui/badge.tsx' && (item.name === 'Badge' || item.name === 'ColorTagBadge')) continue;
    let canonical = false;
    let semantic = false;
    traverse(item.node, node => {
      if (!isOpening(node)) return;
      if (aliases.has(tag(node))) canonical = true;
      if (hasRole(node, WRAPPER_ROLES) && canonicalRoot(node, filename, filename, [item.name])) semantic = true;
    });
    if (!canonical && !semantic) hits.push({ line: line(item.node), kind: 'standalone-wrapper', detail: `${item.name} не рендерит канонический Badge и не имеет предметной роли на корне` });
  }
  for (const diagnostic of sf.parseDiagnostics) hits.push({ line: 1, kind: 'parse-error', detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
  return hits;
}
// typeSelftest() убран 23.09.2026: проверял variant/color-пары местного Badge
// (variant="soft-emphasis" + второй шаг цвета) — компонент удалён миграцией на
// пакетный @chirkov/shell, где tone — плоский закрытый union, его уже держит
// собственная типизация пакета без отдельного самотеста.
function selftest() {
  const badge = 'text-caption px-2 py-0.5 rounded-full';
  const cases = [
    { label: 'tone / пользовательская метка', source: '<Badge tone={{ bg: tag.color }} />', expected: 0 },
    { label: 'tone / цвет из данных с текстом', source: '<Badge tone={{ bg: tag.color, fg: tag.textColor }} />', expected: 0 },
    { label: 'tone / литерал роли', source: '<Badge tone={{ bg: "var(--color-surface-sunken)" }} />', expected: ['palette-through-tone'] },
    { label: 'tone / роль в foreground', source: '<Badge tone={{ bg: tag.color, fg: "var(--color-fg)" }} />', expected: ['palette-through-tone'] },
    { label: 'tone / смешивание', source: '<Badge tone={{ bg: "color-mix(in oklab, var(--color-surface-raised) 25%, transparent)" }} />', expected: ['palette-through-tone'] },
    { label: 'tone / конфиг', source: 'const cfg = { tone: { bg: "var(--color-warning-subtle)" } }; <Badge tone={cfg.tone} />', expected: ['palette-through-tone', 'palette-through-tone'] },
    { label: 'tone / алиас и конкатенация', source: 'const role = "--" + "color-surface-sunken"; const bg = `var(${role})`; <Badge tone={{ bg }} />', expected: ['palette-through-tone'] },
    { label: 'tone / возврат функции', source: 'function getTone() { return { bg: "var(--color-success-subtle)" }; } <Badge tone={getTone()} />', expected: ['palette-through-tone'] },
    { label: 'tone / spread', source: 'const tone = { bg: "var(--color-info-subtle)" }; const props = { tone }; <Badge {...props} />', expected: ['palette-through-tone'] },
    { label: 'tone / переназначенная строка', source: 'let bg = tag.color; bg = "var(--color-info-subtle)"; <Badge tone={{bg}} />', expected: ['palette-through-tone'] },
    { label: 'tone / запись в объект', source: 'const t = {bg:tag.color}; t.bg = "var(--color-info-subtle)"; <Badge tone={t} />', expected: ['palette-through-tone'] },
    // Пакетный Badge читает tone из конфигов вида {tone, dotColor} — сосед по
    // объекту (dotColor с --color-) не должен засорять след поля tone.
    { label: 'tone / сосед по конфигу не течёт', source: 'const cfg = { tone: "accent", dotColor: "var(--color-info)" }; <Badge tone={cfg.tone} />', expected: 0 },
    { label: 'tone / сосед через Record по динамическому ключу', source: 'const META = { a: { tone: "success", dotColor: "var(--color-success)" }, b: { tone: "warning", dotColor: "var(--color-warning)" } }; const m = META[key]; <Badge tone={m.tone} />', expected: 0 },
    { label: 'tone / настоящая утечка через доступ к полю', source: 'const cfg = { tone: "var(--color-danger)", dotColor: "x" }; <Badge tone={cfg.tone} />', expected: ['palette-through-tone', 'palette-through-tone'] },
    { label: 'tone / затенение не подменяет источник', source: 'const bg = "var(--color-danger-subtle)"; function Demo(bg) { return <Badge tone={{ bg }} /> }', expected: 0 },
    { label: 'inline JSX на странице', source: `<div><span className="${badge} bg-success-subtle">Готово</span></div>`, expected: ['inline-badge'] },
    { label: 'div / chip / без border', source: '<div className="rounded-chip px-1.5 text-xs bg-surface-sunken"/>', expected: ['inline-badge'] },
    { label: 'наследуемый размер', source: '<section className="text-dense"><span className="rounded-full px-[7px]"/></section>', expected: ['inline-badge'] },
    { label: 'cn условные цвета', source: `<span className={cn('${badge}', active ? 'bg-success-subtle' : 'bg-surface-sunken')}/>`, expected: ['inline-badge'] },
    { label: 'style / RopBonusCard', source: `<span className="${badge}" style={{backgroundColor: status.bg, color: status.color}}/>`, expected: ['inline-badge'] },
    { label: 'TestCard / неизвестный цвет', source: '<span className={`px-2 py-0.5 rounded-full text-caption font-medium ${s.className}`}/>', expected: ['inline-badge'] },
    { label: 'Badge не прячет сырых детей', source: `<Badge><span className="${badge}"/></Badge>`, expected: ['inline-badge'] },
    { label: 'code, kbd, номер шага', source: `<><code className="${badge}"/><kbd className="${badge}"/><span className="rounded-full w-6 h-6 text-caption"/></>`, expected: 0 },
    { label: 'Badge / обычный текст', source: '<><Badge>Да</Badge><span className="text-caption"/><div className="rounded-full px-2 text-h3"/></>', expected: 0 },
    { label: 'переопределение наследования', source: '<div className="text-caption"><section className="text-h3"><span className="rounded-full px-2"/></section></div>', expected: 0 },
    { label: 'роль не прячет соседа и ребёнка', source: `<><span data-ui-role="icon-counter" className="${badge}"><span className="${badge}"/></span><span className="${badge}"/></>`, expected: ['inline-badge', 'inline-badge'] },
    ...[...ROLES].map(role => ({label: role, source: `<span data-ui-role="${role}" className="${badge}"/>`, expected: 0})),
    { label: 'неизвестная роль', source: `<span data-ui-role="badge" className="${badge}"/>`, expected: ['inline-badge'] },
    { label: 'неизвестные классы', source: '<span className={runtime}/>', expected: ['unresolved-class'] },
    ...['components/ui/Fixture.tsx', 'components/ui/nested/Fixture.jsx', 'components/ui/card.tsx'].flatMap(filename => [
      { label: `сырая плашка в доме ${filename}`, filename, source: `<span className="${badge}"/>`, expected: ['inline-badge'] },
      { label: `сырая плашка с динамикой в доме ${filename}`, filename, source: `<span className={cn('${badge}', className)}/>`, expected: ['inline-badge'] },
      { label: `динамическая сборка в доме ${filename}`, filename, source: 'function Surface({className}){return <span className={cn("flex", className)}/>} ', expected: 0 },
      { label: `spread в доме ${filename}`, filename, source: '<div {...props}/>', expected: 0 },
      { label: `законный wrapper в доме ${filename}`, filename, source: 'import {Badge} from "@/components/ui/badge"; export function StatusBadge(){return <Badge className={className}/>}', expected: 0 },
      { label: `контракт wrapper в доме ${filename}`, filename, source: 'export function StatusBadge(){return <span className={className}/>}', expected: ['standalone-wrapper'] },
    ]),
    ...['components/Fixture.tsx', 'components/ui-extra/Fixture.tsx', 'components/admin/ui/Fixture.tsx', 'components/ui/../forms/Fixture.tsx', 'pages/Fixture.tsx'].map(filename => (
      { label: `динамика вне дома ${filename}`, filename, source: 'function Surface({className}){return <span className={cn("flex", className)}/>} ', expected: ['unresolved-class'] }
    )),
    { label: 'имя wrapper', source: 'export const FreshChip=()=> <i>Чип</i>', expected: ['standalone-wrapper'] },
    { label: 'честный wrapper / alias', source: 'import {Badge as B} from "@/components/ui/badge"; export function StatusBadge(){return <B/>}', expected: 0 },
    { label: 'имя без канонического импорта', source: 'export const FakeBadge=()=> <Badge/>', expected: ['standalone-wrapper'] },
    { label: 'wrapper / канонический Badge из пакета', source: 'import {Badge} from "@chirkov/shell"; export function StatusBadge(){return <Badge tone="neutral"/>}', expected: 0 },
    { label: 'wrapper / алиас пакетного Badge', source: 'import {Badge as B} from "@chirkov/shell"; export function StatusBadge(){return <B tone="neutral"/>}', expected: 0 },
    { label: 'wrapper / ColorTagBadge из местного файла канонический', source: 'import {ColorTagBadge} from "@/components/ui/badge"; export function ErrorTagPill(){return <ColorTagBadge color={tag.color}/>}', expected: 0 },
    { label: 'wrapper / ColorTagBadge из пакета не канонический (там его нет)', source: 'import {ColorTagBadge} from "@chirkov/shell"; export function ErrorTagPill(){return <ColorTagBadge color={tag.color}/>}', expected: ['standalone-wrapper'] },
    { label: 'канонический файл: ColorTagBadge не проверяет себя', filename: 'components/ui/badge.tsx', source: 'export function ColorTagBadge(){return <span className={runtime}/>}', expected: 0 },
    { label: 'небейдж с ролью', source: 'export function AchievementBadge(){return <article data-ui-role="achievement-card"/>}', expected: 0 },
    { label: 'аудиоблок с ролью', source: 'export function TranscriptionStatusBadge(){return <div data-ui-role="transcription-status-panel"/>}', expected: 0 },
    { label: 'небейдж не прячет плашку', source: `export function AchievementBadge(){return <article data-ui-role="achievement-card"><span className="${badge}"/></article>}`, expected: ['inline-badge'] },
    { label: 'канонический файл не пропускается', filename: 'components/ui/badge.tsx', source: `export function Badge(){return <span className={runtime}/>}; function Other(){return <span className="${badge}"/>}`, expected: ['inline-badge'] },
    { label: 'наличие Badge не легализует вторую плашку', source: `import {Badge} from "@/components/ui/badge"; export function StatusBadge(){return <><Badge/><span className="${badge}"/></>}`, expected: ['inline-badge'] },
  ];
  const count = assertSamples('no-standalone-badge', scanSource, cases);
  const root = mkdtempSync(path.join(tmpdir(), 'badge-tone-import-'));
  try {
    writeFileSync(path.join(root, 'palette.ts'), 'export const fill = "var(--color-info-subtle)";');
    writeFileSync(path.join(root, 'bridge.ts'), 'export {fill as background} from "./palette";');
    writeFileSync(path.join(root, 'bad.tsx'), 'import {background} from "./bridge"; const bg: string = background; <Badge tone={{bg}} />');
    writeFileSync(path.join(root, 'good.tsx'), 'function DataBadge({tag}) { return <Badge tone={{bg:tag.color}} /> }');
    const check = toneProject(root);
    const bad = readFileSync(path.join(root, 'bad.tsx'), 'utf8');
    const good = readFileSync(path.join(root, 'good.tsx'), 'utf8');
    assert.equal(check(bad, 'bad.tsx').filter(h => h.kind === 'palette-through-tone').length, 1, 'import + re-export + widened string must fail');
    assert.equal(check(good, 'good.tsx').filter(h => h.kind === 'palette-through-tone').length, 0, 'data color must pass in a project');
    assert.equal(inspectTree(root, check).filter(h => h.kind === 'palette-through-tone').length, 1, 'tree walker must catch imported palette');
  } finally { rmSync(root, { recursive: true, force: true }); }
  return count + 3;
}
const tests = selftest();
if (process.argv.includes('--selftest')) console.log(`✓ no-standalone-badge: ${tests} самопроверок; слом пойман, законные образцы приняты`);
else {
  const root = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) || ROOT);
  process.exitCode = report('no-standalone-badge', inspectTree(root, toneProject(root)));
}
