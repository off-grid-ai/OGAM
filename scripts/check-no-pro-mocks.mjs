#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const testsRoot = path.join(root, '__tests__');
const testFilePattern = /\.(?:js|jsx|ts|tsx)$/;
const proMockPattern = /jest\.(?:doMock|mock)\s*\(\s*(['"])([^'"]*(?:@offgrid\/pro|(?:^|\/)pro(?:\/|$))[^'"]*)\1/gm;
const violations = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(target);
      continue;
    }
    if (!testFilePattern.test(entry.name)) continue;

    const source = fs.readFileSync(target, 'utf8');
    for (const match of source.matchAll(proMockPattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path.relative(root, target)}:${line}: ${match[2]}`);
    }
  }
}

visit(testsRoot);

if (violations.length > 0) {
  console.error('Tests must load real Pro code when the pro submodule is present.');
  console.error('Fake only native, filesystem, network, or other external boundaries.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('No test mocks Pro modules.');
