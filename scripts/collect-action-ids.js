#!/usr/bin/env node
/**
 * Collects every testID written in source (src/ and pro/) into
 * src/services/analytics/actionIds.generated.ts, the only ids `session_summary.actions` may send.
 *
 * - A fixed testID (`"send-button"`) is kept as written.
 * - A template (`kb-document-remove-${id}`) becomes a pattern plus its fixed part
 *   (`kb-document-remove`), so the variable part (an id or a name) never leaves the device.
 *
 * Run `node scripts/collect-action-ids.js` after adding a testID. A unit test fails while the
 * generated file is out of date.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/services/analytics/actionIds.generated.ts');
const SOURCE_DIRS = ['src', 'pro'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', '.git']);
const ID = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
/** A prop or key that holds a testID: testID, rowTestID, testIdFor, nameTestID, … */
const TEST_ID_PROP = /[A-Za-z]*[tT]est[Ii][Dd][A-Za-z]*\s*(?:=|:)\s*/g;

/** `Close panel` → `close-panel`. Null when nothing usable is left. Same rule as OGAD. */
function normalizeActionId(raw) {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/[-:_]{2,}/g, '-')
    .replace(/^[-:_]+|[-:_]+$/g, '')
    .slice(0, 64)
    .replace(/[-:_]+$/, '');
  return ID.test(id) ? id : null;
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Read a quoted string starting at `start` (the quote). Returns [value, end]. */
function readQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  let value = '';
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i += 1;
    value += text[i];
    i += 1;
  }
  return [value, i + 1];
}

/** Read a template literal starting at `start` (the backtick). Returns [fixed parts, end]. */
function readTemplate(text, start) {
  const parts = [''];
  let i = start + 1;
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') {
      parts[parts.length - 1] += text[i + 1];
      i += 2;
    } else if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        else if (text[i] === '`') i = readTemplate(text, i)[1] - 1;
        else if (text[i] === '"' || text[i] === "'") i = readQuoted(text, i)[1] - 1;
        i += 1;
      }
      parts.push('');
    } else {
      parts[parts.length - 1] += text[i];
      i += 1;
    }
  }
  return [parts, i + 1];
}

/** The expression after a testID prop: a literal, or a `{…}` / arrow body up to its end. */
function literalsAfter(text, start, ids, templates) {
  let i = start;
  const ch = text[i];
  if (ch === '"' || ch === "'") {
    ids.add(readQuoted(text, i)[0]);
    return;
  }
  if (ch === '`') {
    templates.push(readTemplate(text, i)[0]);
    return;
  }
  // An expression: scan to the end of its braces/parens, collecting every literal inside.
  let depth = 0;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      if (depth <= 0) return;
    } else if (depth === 0 && (c === ',' || c === ';' || c === '\n' || c === '>')) return;
    else if (c === '"' || c === "'") {
      const [value, end] = readQuoted(text, i);
      ids.add(value);
      i = end - 1;
    } else if (c === '`') {
      const [parts, end] = readTemplate(text, i);
      templates.push(parts);
      i = end - 1;
    }
  }
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function collect(root = ROOT) {
  const ids = new Set();
  const templates = [];
  for (const dir of SOURCE_DIRS) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const file of sourceFiles(base)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(TEST_ID_PROP)) {
        literalsAfter(text, match.index + match[0].length, ids, templates);
      }
    }
  }
  const fixed = [...ids].filter(id => ID.test(id)).sort();
  const patterns = new Map();
  for (const parts of templates) {
    if (parts.length < 2) {
      if (ID.test(parts[0])) fixed.push(parts[0]);
      continue;
    }
    const id = normalizeActionId(parts.join('-'));
    if (!id) continue;
    const source = `^${parts.map(escape).join('.+')}$`;
    // Templates that are only a variable plus a separator say nothing on their own.
    if (parts.join('').replace(/[-:_]/g, '').length === 0) continue;
    patterns.set(source, id);
  }
  // Longest fixed text first, so the most specific pattern wins.
  const ordered = [...patterns.entries()].sort(
    (a, b) => b[0].replace(/\.\+/g, '').length - a[0].replace(/\.\+/g, '').length || a[0].localeCompare(b[0]),
  );
  return { fixed: [...new Set(fixed)].sort(), patterns: ordered };
}

function render({ fixed, patterns }) {
  const lines = [
    '// Generated by scripts/collect-action-ids.js from the testIDs in src/ and pro/. Do not edit.',
    '// Run `node scripts/collect-action-ids.js` after adding a testID.',
    '',
    'export const FIXED_ACTION_IDS: readonly string[] = [',
    ...fixed.map(id => `  ${JSON.stringify(id)},`),
    '];',
    '',
    '/** [pattern source, the template\'s fixed part], most specific first. */',
    'export const TEMPLATE_ACTION_IDS: ReadonlyArray<readonly [string, string]> = [',
    ...patterns.map(([source, id]) => `  [${JSON.stringify(source)}, ${JSON.stringify(id)}],`),
    '];',
    '',
  ];
  return lines.join('\n');
}

module.exports = { collect, render, normalizeActionId, OUT };

if (require.main === module) {
  const result = collect();
  fs.writeFileSync(OUT, render(result));
  process.stdout.write(`${result.fixed.length} fixed ids, ${result.patterns.length} templates → ${path.relative(ROOT, OUT)}\n`);
}
