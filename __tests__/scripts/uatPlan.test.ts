/**
 * scripts/uat.sh's stages, which the parallel nightly runs one job at a time.
 *
 * SPEC: `--plan` names the next beta and changes nothing: the version is the next patch of package.json,
 * N is one past the last `v<version>-beta.<N>` tag, the store build number is a timestamp, and the
 * shared commit is ../shared's HEAD. It prints them as KEY=VALUE and appends them to $GITHUB_OUTPUT,
 * writes the notes where UAT_NOTES_OUT says, and pushes, commits and tags nothing. A later stage
 * without the plan's values refuses to run.
 *
 * The real script runs in a sandbox: throwaway git remotes stand in for GitHub (the network boundary).
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const UAT = path.join(__dirname, '../../scripts/uat.sh');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

/** A repository with one commit on main, pushed to a bare remote it tracks as origin. */
function repo(dir: string, files: Record<string, string>) {
  const remote = `${dir}.git`;
  git(path.dirname(dir), 'init', '-q', '--bare', '-b', 'main', remote);
  git(path.dirname(dir), 'init', '-q', '-b', 'main', dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return remote;
}

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uat-plan-'));
  const mobile = path.join(base, 'mobile');
  const remote = repo(mobile, {
    'package.json': JSON.stringify({ name: 'm', version: '0.0.119' }),
    'scripts/uat.sh': fs.readFileSync(UAT, 'utf8'),
    '.gitignore': '',
  });
  // Earlier betas of the next version: the plan takes the one after the highest.
  git(mobile, 'tag', 'v0.0.120-beta.1');
  git(mobile, 'tag', 'v0.0.120-beta.3');
  git(mobile, 'push', '-q', 'origin', '--tags');
  repo(path.join(base, 'shared'), { 'README.md': 'shared' });
  return { base, mobile, remote };
}

// No claude on PATH: the notes take the grouped commit list, so the run is the same everywhere.
const PATH = `${path.dirname(process.execPath)}:/usr/bin:/bin`;
const run = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync('bash', ['scripts/uat.sh', ...args], { cwd, encoding: 'utf8', env: { HOME: os.tmpdir(), PATH, ...env } });

it('parses', () => {
  expect(spawnSync('bash', ['-n', UAT]).status).toBe(0);
});

it('--plan names the next beta, writes the notes and outputs, and changes nothing', () => {
  const { base, mobile, remote } = sandbox();
  const output = path.join(base, 'github-output');
  const notes = path.join(base, 'notes.md');
  const before = { head: git(mobile, 'rev-parse', 'HEAD'), tags: git(remote, 'tag', '-l') };

  const result = run(mobile, ['--plan', '--android'], { GITHUB_OUTPUT: output, UAT_NOTES_OUT: notes });
  expect(result.status).toBe(0);

  const plan = Object.fromEntries(
    fs.readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=') as [string, string]),
  );
  expect(plan.UAT_VERSION).toBe('0.0.120');
  expect(plan.UAT_BETA_N).toBe('4');
  expect(Number(plan.UAT_BUILD_NUMBER)).toBeGreaterThan(1_700_000_000);
  expect(plan.UAT_SHARED_SHA).toBe(git(path.join(base, 'shared'), 'rev-parse', 'HEAD'));
  expect(result.stdout).toContain('UAT_VERSION=0.0.120');
  expect(fs.readFileSync(notes, 'utf8')).toContain('0.0.120-beta.4');

  // Nothing moved: no commit, no tag, no push, and the tree is as it was.
  expect(git(mobile, 'rev-parse', 'HEAD')).toBe(before.head);
  expect(git(remote, 'tag', '-l')).toBe(before.tags);
  expect(git(mobile, 'status', '--porcelain')).toBe('');
});

it('a stage after the plan refuses to run without the plan’s values', () => {
  const { mobile } = sandbox();
  for (const stage of ['--build-only', '--upload-only', '--finalize']) {
    const result = run(mobile, [stage, '--android']);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/UAT_VERSION is not set/);
  }
});
