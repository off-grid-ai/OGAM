/**
 * Tests run our own code for real; only the device boundary is faked.
 *
 * SPEC (docs/test-audit/mobile-a.md): no test file, harness, helper, fixture or Jest setup file may `jest.mock` / `jest.doMock` a module of ours,
 * nor `jest.spyOn` one. "Ours" is any relative path, `@/…`, a `src/…` path, `@offgrid/…` (core, pro,
 * the shared packages), and `@react-navigation/native` (stubbing it fakes our navigation: routes, focus,
 * navigate). Everything else is the device boundary and may be faked: native modules (llama.rn,
 * whisper.rn, the video bridge, react-native-fs, async-storage, NativeModules), the network, the clock,
 * RAM. Those are npm packages or globals, so they never match the rule.
 *
 * Files written before the rule are listed in __tests__/mockBaseline.json with how many mocks of ours
 * they still hold. A file outside the list may hold none; a listed file may never gain one; and a file
 * that is down to zero must leave the list, so the list only shrinks.
 *
 * After fixing a file, refresh the list: UPDATE_MOCK_BASELINE=1 npx jest __tests__/scripts/noMocksOfOurCode
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const BASELINE = path.join(ROOT, '__tests__/mockBaseline.json');

/** A module specifier that names our own code (see the header). */
export function isOurs(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('@/') ||
    /(^|\/)src\//.test(specifier) ||
    specifier.startsWith('@offgrid/') ||
    specifier === '@react-navigation/native'
  );
}

/** Source with its comments removed: a usage example in a doc comment mocks nothing. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Each mock or spy of our code in one test file's source, as `mock <specifier>` / `spyOn <name>`. */
export function mocksOfOurs(text: string): string[] {
  const source = withoutComments(text);
  const found: string[] = [];
  for (const match of source.matchAll(/jest\.(?:mock|doMock)\(\s*(['"`])([^'"`]+)\1/g)) {
    if (isOurs(match[2])) found.push(`mock ${match[2]}`);
  }
  // Names bound to our modules: import x / import { a, b } / import * as x / const x = require(...).
  const bound = new Set<string>();
  for (const match of source.matchAll(/import\s+([^'";]+?)\s+from\s+(['"])([^'"]+)\2/g)) {
    if (!isOurs(match[3]) || /^type\s/.test(match[1])) continue;
    for (const name of match[1].replace(/[{}*]/g, ' ').split(/[\s,]+/)) {
      if (name && name !== 'as' && name !== 'type') bound.add(name);
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([^=]+?)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    if (!isOurs(match[3])) continue;
    for (const name of match[1].replace(/[{}]/g, ' ').split(/[\s,:]+/)) if (name) bound.add(name);
  }
  for (const match of source.matchAll(/jest\.spyOn\(\s*([^,]+),/g)) {
    const target = match[1].trim();
    const inline = /require\(\s*(['"])([^'"]+)\1\s*\)/.exec(target);
    const root = target.split(/[.([]/)[0];
    if ((inline && isOurs(inline[2])) || bound.has(root)) found.push(`spyOn ${target}`);
  }
  return found;
}

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

function scan(): Record<string, number> {
  const counts: Record<string, number> = {};
  // Every file a test runs: the tests, their harnesses, helpers and fixtures, and Jest's setup file. A
  // harness that mocks our code makes every test that uses it a mockist test.
  for (const file of [...testFiles(path.join(ROOT, '__tests__')), path.join(ROOT, 'jest.setup.ts')]) {
    const relative = path.relative(ROOT, file);
    // This file names the rule's patterns in its own source; it mocks nothing.
    if (relative === path.relative(ROOT, __filename)) continue;
    const count = mocksOfOurs(fs.readFileSync(file, 'utf8')).length;
    if (count) counts[relative] = count;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

it('names our code and leaves the device boundary alone', () => {
  for (const ours of ['../../src/stores', '@/services/llm', '@offgrid/core/stores', '@offgrid/pro', '@react-navigation/native'])
    expect(isOurs(ours)).toBe(true);
  for (const boundary of ['llama.rn', 'whisper.rn', 'react-native-fs', '@react-native-async-storage/async-storage', 'react-native'])
    expect(isOurs(boundary)).toBe(false);
  const sample = [
    "import { llmService } from '../../src/services/llm';",
    "import RNFS from 'react-native-fs';",
    "const { useAppStore } = require('../../src/stores');",
    "jest.mock('../../src/services/hardware');",
    "jest.mock('llama.rn');",
    "jest.spyOn(llmService, 'load');",
    "jest.spyOn(useAppStore, 'getState');",
    "jest.spyOn(RNFS, 'exists');",
    "jest.spyOn(console, 'warn');",
    "jest.spyOn(require('../../src/services/x').service, 'run');",
  ].join('\n');
  expect(mocksOfOurs(sample)).toEqual([
    'mock ../../src/services/hardware',
    "spyOn llmService",
    'spyOn useAppStore',
    "spyOn require('../../src/services/x').service",
  ]);
});

it('no test file mocks our code beyond the baseline, and the baseline only shrinks', () => {
  const now = scan();
  if (process.env.UPDATE_MOCK_BASELINE) fs.writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const problems: string[] = [];
  for (const [file, count] of Object.entries(now)) {
    if (!(file in baseline)) problems.push(`${file}: mocks our code (${count}); fake only the device boundary`);
    else if (count > baseline[file]) problems.push(`${file}: ${count} mocks of our code, up from ${baseline[file]}`);
  }
  for (const [file, count] of Object.entries(baseline)) {
    if (!(file in now)) problems.push(`${file}: no longer mocks our code; remove it from __tests__/mockBaseline.json`);
    else if (now[file] < count) problems.push(`${file}: down to ${now[file]} from ${count}; lower it in __tests__/mockBaseline.json`);
  }
  expect(problems).toEqual([]);
});
