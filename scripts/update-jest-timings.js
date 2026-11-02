#!/usr/bin/env node
/**
 * Rewrite scripts/jest-timings.json, the suite run times the CI shards are balanced by
 * (scripts/jest-sequencer.js), from the results of a full CI run.
 *
 *   gh run download <run id> --pattern 'jest-results-*' --dir /tmp/jest-results
 *   node scripts/update-jest-timings.js /tmp/jest-results
 *
 * Each shard saves its `jest --json` results as a jest-results-<n> artifact. Every suite in them is
 * written with its run time in seconds, keyed by its path from this directory; a suite the results
 * do not hold keeps no entry, and the sequencer estimates it from its size.
 */
const fs = require('node:fs');
const path = require('node:path');

const TIMINGS_FILE = path.join(__dirname, 'jest-timings.json');

function resultFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(dir, file));
}

function main([dir], root = process.cwd()) {
  if (!dir) throw new Error('usage: update-jest-timings.js <directory of jest --json results>');
  const timings = {};
  for (const file of resultFiles(dir)) {
    for (const suite of JSON.parse(fs.readFileSync(file, 'utf8')).testResults) {
      const key = path.relative(root, suite.name).split(path.sep).join('/');
      timings[key] = Math.round((suite.endTime - suite.startTime) / 100) / 10;
    }
  }
  const suites = Object.keys(timings).sort();
  if (suites.length === 0) throw new Error(`no jest results under ${dir}`);
  const sorted = Object.fromEntries(suites.map(key => [key, timings[key]]));
  fs.writeFileSync(TIMINGS_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Recorded the run times of ${suites.length} suites.`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
