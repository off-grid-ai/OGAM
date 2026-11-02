/**
 * Jest's test sequencer, with shards balanced by run time instead of by file count.
 *
 * CI runs the suite in shards (`--shard=i/n`). Jest's own split gives each shard the same NUMBER
 * of suites, but a handful of rendered app suites take 20-60 s while most take about a second, so
 * one shard ran twice as long as another. Here every suite gets its recorded run time from
 * scripts/jest-timings.json (refresh it with scripts/update-jest-timings.js), or, for a suite with
 * no record yet, an estimate from its file size. The longest suites are placed first, each on the
 * shard with the least time so far. The order within a shard is still Jest's own.
 */
const fs = require('node:fs');
const path = require('node:path');
const Sequencer = require('@jest/test-sequencer').default;

const TIMINGS_FILE = path.join(__dirname, 'jest-timings.json');
// On the CI shards a suite with no recorded time averaged about 1.2 s at about 6.4 KB.
const BYTES_PER_SECOND = 5400;

function readTimings(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function suiteKey(test) {
  return path.relative(test.context.config.rootDir, test.path).split(path.sep).join('/');
}

function suiteSeconds(test, timings) {
  const recorded = timings[suiteKey(test)];
  return typeof recorded === 'number' ? recorded : fs.statSync(test.path).size / BYTES_PER_SECOND;
}

/** Split the tests into `shardCount` lists of about equal total time. Same input, same split. */
function balance(tests, shardCount, timings) {
  const shards = Array.from({ length: shardCount }, () => ({ seconds: 0, tests: [] }));
  const timed = tests
    .map(test => ({ test, seconds: suiteSeconds(test, timings) }))
    .sort((a, b) => b.seconds - a.seconds || (a.test.path < b.test.path ? -1 : 1));
  for (const { test, seconds } of timed) {
    const lightest = shards.reduce((min, shard) => (shard.seconds < min.seconds ? shard : min));
    lightest.tests.push(test);
    lightest.seconds += seconds;
  }
  return shards;
}

class DurationSequencer extends Sequencer {
  shard(tests, { shardIndex, shardCount }) {
    return balance(tests, shardCount, readTimings(TIMINGS_FILE))[shardIndex - 1].tests;
  }
}

module.exports = DurationSequencer;
module.exports.balance = balance;
module.exports.readTimings = readTimings;
