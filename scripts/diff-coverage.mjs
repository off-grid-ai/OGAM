#!/usr/bin/env node
// Diff-coverage gate: every executable line CHANGED on this branch vs the base must be
// covered by the Jest run. Enforces the "new code = 100%" standard that the 80% global
// floor in jest.config.js cannot (new gaps hide under the aggregate).
//
// Reads istanbul coverage/coverage-final.json (produced by `jest --coverageReporters=json`)
// and intersects covered lines with the added/modified src lines from `git diff`.
//
// Usage: node scripts/diff-coverage.mjs [--base origin/main] [--threshold 100]
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const threshold = args.includes('--threshold') ? Number(args[args.indexOf('--threshold') + 1]) : 100;

const COV = 'coverage/coverage-final.json';
if (!existsSync(COV)) {
  console.error(`diff-coverage: ${COV} not found — run jest with --coverageReporters=json first.`);
  process.exit(1);
}

// Files we hold to the new-code bar. Tests/config/generated are excluded.
const INCLUDE = (f) => f.startsWith('src/') && /\.(ts|tsx)$/.test(f) && !/\.(test|spec|d)\.tsx?$/.test(f);

// 1. Changed line ranges per file (added/modified only).
function changedLines() {
  let diff;
  try {
    diff = execSync(`git diff --unified=0 ${base}...HEAD -- 'src/**/*.ts' 'src/**/*.tsx'`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`diff-coverage: git diff against ${base} failed — is the base ref fetched?`);
    process.exit(1);
  }
  const map = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    const fm = line.match(/^\+\+\+ b\/(.+)$/);
    if (fm) { file = fm[1]; if (INCLUDE(file) && !map.has(file)) map.set(file, new Set()); continue; }
    if (!file || !INCLUDE(file)) continue;
    const hm = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hm) {
      const start = Number(hm[1]);
      const count = hm[2] === undefined ? 1 : Number(hm[2]);
      for (let i = 0; i < count; i++) map.get(file).add(start + i);
    }
  }
  return map;
}

// 2. Covered executable lines per file, from istanbul statementMap + s counters.
const cov = JSON.parse(readFileSync(COV, 'utf8'));
const covByFile = new Map();
for (const [abs, data] of Object.entries(cov)) {
  const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
  const execLines = new Map(); // line -> covered?
  for (const [id, st] of Object.entries(data.statementMap)) {
    const hits = data.s[id] || 0;
    for (let ln = st.start.line; ln <= (st.end.line || st.start.line); ln++) {
      execLines.set(ln, (execLines.get(ln) || false) || hits > 0);
    }
  }
  covByFile.set(rel, execLines);
}

// 3. Intersect.
const changed = changedLines();
let totalExec = 0, totalCovered = 0;
const gaps = [];
for (const [file, lines] of changed) {
  const exec = covByFile.get(file);
  if (!exec) continue; // file has no executable statements instrumented (e.g. pure types)
  for (const ln of lines) {
    if (!exec.has(ln)) continue; // changed line is not an executable statement (blank/comment/type)
    totalExec++;
    if (exec.get(ln)) totalCovered++;
    else gaps.push(`${file}:${ln}`);
  }
}

if (totalExec === 0) {
  console.log('diff-coverage: no changed executable src lines to check — OK.');
  process.exit(0);
}
const pct = (totalCovered / totalExec) * 100;
console.log(`diff-coverage: ${totalCovered}/${totalExec} changed executable lines covered (${pct.toFixed(2)}%), threshold ${threshold}%`);
if (pct + 1e-9 < threshold) {
  console.error(`diff-coverage: FAIL — ${gaps.length} uncovered changed line(s):`);
  for (const g of gaps.slice(0, 50)) console.error(`  ${g}`);
  if (gaps.length > 50) console.error(`  … and ${gaps.length - 50} more`);
  process.exit(1);
}
console.log('diff-coverage: PASS');
