#!/usr/bin/env node
/**
 * Merge the coverage of the CI Jest shards and gate it, as one unsharded run would.
 *
 *   node scripts/merge-coverage.js <directory holding each shard's coverage-final.json>
 *
 * Each shard covers only its own share of the suites, so a shard cannot check the thresholds in
 * jest.config.js: every file the other shards cover would look uncovered. The shards run with the
 * thresholds off and save their raw coverage; this script gives all of it to Jest's own coverage
 * reporter, which writes the reports in jest.config.js's coverageReporters (lcov for Codecov) and
 * checks coverageThreshold with Jest's own rules. Run it from the directory that holds
 * jest.config.js, on the same runner image as the shards, so the file paths in the coverage match.
 */
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('jest-config');
const { CoverageReporter } = require('@jest/reporters');

function shardCoverageFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .filter(file => path.basename(file) === 'coverage-final.json')
    .map(file => path.join(dir, file))
    .sort();
}

async function main([dir]) {
  if (!dir) throw new Error('usage: merge-coverage.js <shard coverage directory>');
  const files = shardCoverageFiles(dir);
  if (files.length === 0) throw new Error(`no coverage-final.json under ${dir}`);

  const { globalConfig } = await readConfig({ coverage: true }, process.cwd());
  const reporter = new CoverageReporter(globalConfig, {});
  for (const file of files) {
    reporter.onTestResult({}, { coverage: JSON.parse(fs.readFileSync(file, 'utf8')) });
  }
  await reporter.onRunComplete(new Set(), {});
  console.log(`Merged the coverage of ${files.length} shards.`);
  return reporter.getLastError() ? 1 : 0;
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
