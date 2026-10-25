/** Shared JSX measurement for the component gates. No file-level exclusions. */
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { twMerge as appCn } from '../src/lib/tailwind-merge-config.js';
export { ts, appCn };
const LIMIT = 512;
function unique(values) {
  const out = [...new Set(values)];
  if (out.length > LIMIT) throw new Error('variant-limit');
  return out;
}

function combine(left, right, separator = ' ') {
  const out = [];
  for (const a of left) {
    for (const b of right) {
      out.push(`${a}${separator}${b}`);
      if (out.length > LIMIT) throw new Error('variant-limit');
    }
  }
  return unique(out);
}

function result(values = [''], dynamic = false) {
  return { values: unique(values), dynamic };
}

function objectValues(node, bindings, seen) {
  if (ts.isIdentifier(node) && bindings.has(node) && !seen.has(node.text)) {
    const nextSeen = new Set(seen).add(node.text);
    return objectValues(bindings.get(node), bindings, nextSeen);
  }
  if (!ts.isObjectLiteralExpression(node) && !ts.isArrayLiteralExpression(node)) return null;
  const nodes = ts.isArrayLiteralExpression(node)
    ? [...node.elements]
    : node.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) ? [property.initializer] : []);
  let dynamic = ts.isObjectLiteralExpression(node) && node.properties.some(p => !ts.isPropertyAssignment(p));
  const values = [];
  for (const item of nodes) {
    const resolved = scenarios(item, bindings, seen);
    values.push(...resolved.values);
    dynamic ||= resolved.dynamic;
  }
  return result(values.length ? values : [''], dynamic);
}

function scenarios(node, bindings, seen = new Set()) {
  if (!node) return result();
  if ([ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return result();
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return result([node.text]);
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression?.(node)) return scenarios(node.expression, bindings, seen);
  if (ts.isIdentifier(node)) {
    if (['undefined', 'null', 'false', 'true'].includes(node.text)) return result();
    if (bindings.has(node) && !seen.has(node.text)) {
      return scenarios(bindings.get(node), bindings, new Set(seen).add(node.text));
    }
    return result([''], true);
  }
  if (ts.isTemplateExpression(node)) {
    let out = result([node.head.text]);
    for (const span of node.templateSpans) {
      const middle = scenarios(span.expression, bindings, seen);
      out = result(
        combine(out.values, middle.values, '').map((value) => `${value}${span.literal.text}`),
        out.dynamic || middle.dynamic,
      );
    }
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    const yes = scenarios(node.whenTrue, bindings, seen);
    const no = scenarios(node.whenFalse, bindings, seen);
    return result([...yes.values, ...no.values], yes.dynamic || no.dynamic);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const right = scenarios(node.right, bindings, seen);
      return result(['', ...right.values], right.dynamic);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const left = scenarios(node.left, bindings, seen);
      const right = scenarios(node.right, bindings, seen);
      return result([...left.values, ...right.values], left.dynamic || right.dynamic);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = scenarios(node.left, bindings, seen);
      const right = scenarios(node.right, bindings, seen);
      return result(combine(left.values, right.values, ''), left.dynamic || right.dynamic);
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    let out = result();
    for (const item of node.elements) {
      const next = scenarios(item, bindings, seen);
      out = result(combine(out.values, next.values), out.dynamic || next.dynamic);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    let values = [''];
    let dynamic = false;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) { dynamic = true; continue; }
      const name = property.name;
      if (!ts.isStringLiteralLike(name) && !ts.isIdentifier(name)) {
        dynamic = true;
        continue;
      }
      const condition = ts.isPropertyAssignment(property) ? property.initializer : null;
      const absent = condition && ([ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(condition.kind)
        || ts.isNumericLiteral(condition) && Number(condition.text) === 0
        || ts.isStringLiteralLike(condition) && condition.text === '');
      if (absent) continue;
      const present = condition?.kind === ts.SyntaxKind.TrueKeyword;
      values = combine(values, present ? [name.text] : ['', name.text]);
    }
    return result(values, dynamic);
  }
  if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
    // A dynamic lookup into a literal dictionary can enumerate every value.
    // Property access is deliberately unresolved unless its exact key is known.
    let base = node.expression;
    const visited = new Set();
    while (ts.isIdentifier(base) && bindings.has(base) && !visited.has(base.text)) {
      visited.add(base.text);
      base = bindings.get(base);
    }
    while (ts.isAsExpression(base) || ts.isSatisfiesExpression?.(base) || ts.isParenthesizedExpression(base)) base = base.expression;
    const key = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
    if (ts.isObjectLiteralExpression(base) && key !== null) {
      const property = [...base.properties].reverse().find(p => ts.isPropertyAssignment(p) && p.name?.text === key);
      if (base.properties.some(p => ts.isSpreadAssignment(p) || p.name && ts.isComputedPropertyName(p.name))) return result([''], true);
      if (property) return scenarios(property.initializer, bindings, seen);
    }
    if (ts.isElementAccessExpression(node) && key === null) {
      const all = objectValues(base, bindings, seen);
      if (all) return all;
    }
    return result([''], true);
  }
  if (ts.isCallExpression(node)) {
    const isCn = ts.isIdentifier(node.expression) && ['cn', 'clsx'].includes(node.expression.text);
    if (!isCn) return result([''], true);
    let out = result();
    for (const argument of node.arguments) {
      const next = scenarios(argument, bindings, seen);
      out = result(combine(out.values, next.values), out.dynamic || next.dynamic);
    }
    return result(out.values.map((value) => appCn(value)), out.dynamic);
  }
  return result([''], true);
}

export function parse(source, filename = 'fixture.tsx') {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.jsx') ? ts.ScriptKind.JSX : filename.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const host = {
    getSourceFile: name => name === filename ? sf : undefined,
    getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: name => name === filename,
    readFile: name => name === filename ? source : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  };
  const checker = ts.createProgram([filename], { noLib: true, noResolve: true, allowJs: true }, host).getTypeChecker();
  const initializer = node => {
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    // Mutable bindings cannot be proved from their initial value.
    return declaration && ts.isVariableDeclaration(declaration)
      && (declaration.parent.flags & ts.NodeFlags.Const) ? declaration.initializer : undefined;
  };
  const bindings = { has: node => !!initializer(node), get: initializer };
  const classes = node => {
    const attr = attribute(node, 'className');
    const expression = attr && attributeExpression(attr);
    try {
      const resolved = scenarios(expression, bindings);
      // A spread may supply or override className; never silently declare it clean.
      const spread = node.attributes.properties.some(ts.isJsxSpreadAttribute);
      return { ...resolved, dynamic: resolved.dynamic || spread, detail: expression?.getText(sf) ?? 'JSX spread' };
    } catch (error) {
      if (error.message !== 'variant-limit') throw error;
      return { values: [], dynamic: true, detail: 'variant-limit: более 512 вариантов className' };
    }
  };
  return { sf, checker, classes, line: node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
}

export const isOpening = node => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
export const tag = node => node.tagName.getText();
export function attribute(node, name) {
  return node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.text === name);
}
export function attributeExpression(attr) {
  return attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
}
export function literalAttribute(node, name) {
  const attr = attribute(node, name);
  if (!attr) return undefined;
  // A later spread can overwrite a literal role/type/className.
  if (node.attributes.properties.slice(node.attributes.properties.indexOf(attr) + 1).some(ts.isJsxSpreadAttribute)) return undefined;
  const expr = attributeExpression(attr);
  return expr && ts.isStringLiteralLike(expr) ? expr.text : undefined;
}
export function hasRole(node, roles) {
  return roles.has(literalAttribute(node, 'data-ui-role'));
}
export function traverse(node, visit) {
  visit(node);
  ts.forEachChild(node, child => traverse(child, visit));
}
export function enclosingComponent(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text;
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      let parent = current.parent;
      while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent;
      return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : undefined;
    }
  }
}

// Исключается только диагноз unresolved-class: принимать className и собирать
// варианты — работа компонентов в frontend/src/components/ui. Это НЕ пропуск
// файла: сырые рецепты, теги, wrapper-контракт и ошибки разбора проверяются всегда.
// Вызывать только в ветке unresolved-class, после проверки известного рецепта.
// filename — путь относительно проверяемого src; соседние components не входят.
export function unresolvedClassesForbidden(filename) {
  return !path.posix.normalize(filename.replaceAll('\\', '/')).startsWith('components/ui/');
}

// Only the actual returned element of a named canonical implementation is legal.
// The rest of the file and nested JSX children remain measured.
export function canonicalRoot(node, filename, file, names) {
  if (filename.replaceAll('\\', '/') !== file || !names.includes(enclosingComponent(node))) return false;
  let current = ts.isJsxOpeningElement(node) ? node.parent : node;
  while (current.parent && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return ts.isReturnStatement(current.parent)
    || ts.isArrowFunction(current.parent) && current.parent.body === current;
}

export function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(?:tsx|jsx|ts)$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

export function inspectTree(root, scanSource) {
  const files = walk(root);
  if (!files.length) throw new Error(`Нет исходников для проверки: ${root}`);
  return files.flatMap(full => {
    const relative = path.relative(root, full).split(path.sep).join('/');
    return scanSource(fs.readFileSync(full, 'utf8'), relative).map(hit => ({ file: relative, ...hit }));
  });
}

export function report(name, hits) {
  const counts = Object.fromEntries([...new Set(hits.map(h => h.kind))].map(kind => [kind, hits.filter(h => h.kind === kind).length]));
  if (process.argv.includes('--json')) console.log(JSON.stringify({ gate: name, total: hits.length, counts, hits }, null, 2));
  else {
    console.log(`${hits.length ? '✗' : '✓'} ${name}: ${hits.length} блокеров; ${JSON.stringify(counts)}`);
    for (const hit of hits) console.log(`  ${hit.file}:${hit.line} [${hit.kind}] ${hit.detail}`);
  }
  return hits.length ? 1 : 0;
}

export function assertSamples(name, scanSource, cases) {
  for (const { label, source, expected, filename = 'pages/Fixture.jsx' } of cases) {
    const hits = scanSource(source, filename);
    const actual = typeof expected === 'number' ? hits.length : hits.map(h => h.kind);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${name} selftest ${label}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(hits)}`);
    }
  }
  // Exercise the production directory walker, not just an isolated AST helper.
  const dirty = cases.find(c => Array.isArray(c.expected) ? c.expected.length > 0 : c.expected > 0);
  const clean = cases.find(c => c.expected === 0 && !c.filename);
  const box = fs.mkdtempSync(path.join(tmpdir(), 'ro-gate-'));
  try {
    fs.mkdirSync(path.join(box, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(box, 'components', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(box, 'pages', 'Dirty.jsx'), dirty.source);
    fs.writeFileSync(path.join(box, 'components', 'nested', 'Dirty.tsx'), dirty.source);
    fs.writeFileSync(path.join(box, 'pages', 'Clean.jsx'), clean.source);
    fs.writeFileSync(path.join(box, 'classes.ts'), 'const layout = "flex";');
    const hits = inspectTree(box, scanSource);
    const expected = (Array.isArray(dirty.expected) ? dirty.expected.length : dirty.expected) * 2;
    if (hits.length !== expected || hits.some(h => h.file.includes('Clean'))) throw new Error(`${name}: обход src/pages/*.jsx или src/components/**/*.tsx сломан`);
    // Path-sensitive samples must also pass through the production walker: an AST
    // assertion alone would miss a future directory-wide exclusion in walk().
    for (const [index, sample] of cases.entries()) {
      if (!sample.filename) continue;
      const root = path.join(box, 'located', String(index), 'src');
      const full = path.join(root, sample.filename.replaceAll('\\', '/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, sample.source);
      const locatedHits = inspectTree(root, scanSource);
      const actual = typeof sample.expected === 'number' ? locatedHits.length : locatedHits.map(h => h.kind);
      if (JSON.stringify(actual) !== JSON.stringify(sample.expected)) {
        throw new Error(`${name} обход ${sample.label}: ожидалось ${JSON.stringify(sample.expected)}, получено ${JSON.stringify(locatedHits)}`);
      }
    }
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
  return cases.length + 1 + cases.filter(sample => sample.filename).length;
}
