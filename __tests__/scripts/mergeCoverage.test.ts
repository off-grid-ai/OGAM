/**
 * The CI coverage gate for the sharded Jest run (scripts/merge-coverage.js).
 *
 * SPEC: each shard saves only the coverage of its own suites. The script merges every shard's
 * coverage-final.json and gives it to Jest's coverage reporter, which writes the reports and checks
 * jest.config.js's coverageThreshold. Coverage that only the shards together reach passes; a gap
 * that remains after the merge fails the run, as it would in one unsharded run.
 *
 * The real script runs as CI runs it, in a project with its own jest.config.js.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '../../scripts/merge-coverage.js');

// One file with two statements. Each shard runs one of them.
function fileCoverage(file: string, hits: [number, number]) {
  const location = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
  return {
    [file]: {
      path: file,
      statementMap: { 0: location(1), 1: location(2) },
      fnMap: {},
      branchMap: {},
      s: { 0: hits[0], 1: hits[1] },
      f: {},
      b: {},
    },
  };
}

function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-coverage-')));
  fs.writeFileSync(
    path.join(root, 'jest.config.js'),
    `module.exports = {
      coverageReporters: ['json-summary'],
      coverageThreshold: { global: { statements: 100, lines: 100 } },
    };\n`,
  );
  return root;
}

function shard(root: string, name: string, hits: [number, number]) {
  const dir = path.join(root, 'shards', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'coverage-final.json'),
    JSON.stringify(fileCoverage(path.join(root, 'a.js'), hits)),
  );
}

function merge(root: string, ...args: string[]) {
  return spawnSync('node', [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
}

describe('merge-coverage', () => {
  it('passes the threshold that only the shards together reach, and writes the merged report', () => {
    const root = project();
    shard(root, 'coverage-shard-1', [1, 0]);
    shard(root, 'coverage-shard-2', [0, 3]);

    const run = merge(root, 'shards');

    expect(run.stderr).not.toContain('not met');
    expect(run.stdout).toContain('Merged the coverage of 2 shards.');
    expect(run.status).toBe(0);
    const summary = JSON.parse(fs.readFileSync(path.join(root, 'coverage/coverage-summary.json'), 'utf8'));
    expect(summary.total.statements).toMatchObject({ total: 2, covered: 2, pct: 100 });
  });

  it('fails when a gap remains after the merge', () => {
    const root = project();
    shard(root, 'coverage-shard-1', [1, 0]);
    shard(root, 'coverage-shard-2', [2, 0]);

    const run = merge(root, 'shards');

    expect(run.stderr).toContain('"global" coverage threshold for statements (100%) not met: 50%');
    expect(run.status).toBe(1);
  });

  it('fails when no shard saved any coverage', () => {
    const root = project();
    fs.mkdirSync(path.join(root, 'shards'));

    const run = merge(root, 'shards');

    expect(run.stderr).toContain('no coverage-final.json under shards');
    expect(run.status).toBe(1);
  });

  it('fails without a directory to read', () => {
    const run = merge(project());

    expect(run.stderr).toContain('usage: merge-coverage.js');
    expect(run.status).toBe(1);
  });
});
