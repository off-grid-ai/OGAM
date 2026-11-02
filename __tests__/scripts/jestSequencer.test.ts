/**
 * CI's Jest shards, balanced by run time (scripts/jest-sequencer.js) and the run times they are
 * balanced by (scripts/update-jest-timings.js).
 *
 * SPEC: every suite is placed, once, on the shard with the least time so far, longest first. A
 * suite's time is its recorded run time, or an estimate from its file size when it has none. The
 * timings file is rewritten from the `jest --json` results that the CI shards save.
 *
 * Real suite files on disk and the real update script, run as a maintainer runs it.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DurationSequencer = require('../../scripts/jest-sequencer.js');
const { balance, readTimings } = DurationSequencer;

const UPDATE = path.join(__dirname, '../../scripts/update-jest-timings.js');

function suites(sizes: Record<string, number>) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jest-sequencer-')));
  const tests = Object.entries(sizes).map(([name, size]) => {
    const file = path.join(root, '__tests__', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x'.repeat(size));
    return { path: file, context: { config: { rootDir: root } } };
  });
  return { root, tests };
}

const names = (shard: { tests: Array<{ path: string }> }) => shard.tests.map(t => path.basename(t.path)).sort();

describe('jest-sequencer', () => {
  it('splits by recorded time, not by count', () => {
    const { tests } = suites({ 'slow.test.ts': 10, 'a.test.ts': 10, 'b.test.ts': 10, 'c.test.ts': 10 });
    const timings = {
      '__tests__/slow.test.ts': 30,
      '__tests__/a.test.ts': 10,
      '__tests__/b.test.ts': 10,
      '__tests__/c.test.ts': 10,
    };

    const shards = balance(tests, 2, timings);

    expect(names(shards[0])).toEqual(['slow.test.ts']);
    expect(names(shards[1])).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
    expect(shards.map((s: { seconds: number }) => s.seconds)).toEqual([30, 30]);
  });

  it('estimates a suite with no record from its file size', () => {
    const { tests } = suites({ 'big.test.ts': 54000, 'small1.test.ts': 5400, 'small2.test.ts': 5400 });

    const shards = balance(tests, 2, {});

    expect(names(shards[0])).toEqual(['big.test.ts']);
    expect(shards[0].seconds).toBe(10);
    expect(names(shards[1])).toEqual(['small1.test.ts', 'small2.test.ts']);
  });

  it('places every suite once, the same way every time', () => {
    const { tests } = suites({ 'a.test.ts': 100, 'b.test.ts': 100, 'c.test.ts': 100, 'd.test.ts': 100, 'e.test.ts': 100 });

    const first = balance(tests, 3, {}).map(names);
    const again = balance([...tests].reverse(), 3, {}).map(names);

    expect(again).toEqual(first);
    expect(first.flat().sort()).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts']);
  });

  it("returns the requested shard's suites, from the committed timings", () => {
    const { tests } = suites({ 'a.test.ts': 10, 'b.test.ts': 20 });
    const sequencer = new DurationSequencer();

    const all = [1, 2].flatMap(shardIndex => sequencer.shard(tests, { shardIndex, shardCount: 2 }));

    expect(all.map((t: { path: string }) => path.basename(t.path)).sort()).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('reads no timings from a file that is not there', () => {
    expect(readTimings(path.join(os.tmpdir(), 'no-such-timings.json'))).toEqual({});
  });
});

describe('update-jest-timings', () => {
  const timingsFile = path.join(__dirname, '../../scripts/jest-timings.json');
  let committed: string;
  beforeEach(() => {
    committed = fs.readFileSync(timingsFile, 'utf8');
  });
  afterEach(() => {
    fs.writeFileSync(timingsFile, committed);
  });

  function results(root: string, shard: string, suitesRun: Array<[string, number]>) {
    const dir = path.join(root, 'results', shard);
    fs.mkdirSync(dir, { recursive: true });
    const testResults = suitesRun.map(([name, ms]) => ({ name: path.join(root, name), startTime: 1000, endTime: 1000 + ms }));
    fs.writeFileSync(path.join(dir, 'jest-results.json'), JSON.stringify({ testResults }));
  }

  it('records every suite of every shard, in seconds, keyed by its path', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jest-timings-')));
    results(root, 'jest-results-1', [['__tests__/b.test.ts', 12345]]);
    results(root, 'jest-results-2', [['__tests__/a.test.ts', 870]]);

    const run = spawnSync('node', [UPDATE, 'results'], { cwd: root, encoding: 'utf8' });

    expect(run.stdout).toContain('Recorded the run times of 2 suites.');
    expect(run.status).toBe(0);
    expect(fs.readFileSync(timingsFile, 'utf8')).toBe(
      '{\n  "__tests__/a.test.ts": 0.9,\n  "__tests__/b.test.ts": 12.3\n}\n',
    );
  });

  it('fails, and keeps the timings, when there are no results', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-timings-'));
    fs.mkdirSync(path.join(root, 'results'));

    const run = spawnSync('node', [UPDATE, 'results'], { cwd: root, encoding: 'utf8' });

    expect(run.stderr).toContain('no jest results under results');
    expect(run.status).toBe(1);
    expect(fs.readFileSync(timingsFile, 'utf8')).toBe(committed);
  });

  it('fails without a directory to read', () => {
    const run = spawnSync('node', [UPDATE], { encoding: 'utf8' });

    expect(run.stderr).toContain('usage: update-jest-timings.js');
    expect(run.status).toBe(1);
  });
});
