/** Real release scripts and Git repos. Store builds and hosted release APIs are external boundaries. */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
let root: string;
let mobile: string;
let shared: string;
let env: NodeJS.ProcessEnv;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

function save(cwd: string, name: string, contents: string) {
  writeFileSync(join(cwd, name), contents);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-m', name);
}

function repository(name: string): string {
  const cwd = join(root, name);
  const origin = join(root, `${name}-origin.git`);
  mkdirSync(cwd);
  execFileSync('git', ['init', '--bare', origin], { env });
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'Release fixture');
  git(cwd, 'config', 'user.email', 'release@example.test');
  git(cwd, 'remote', 'add', 'origin', origin);
  save(cwd, '.gitignore', 'build/\n');
  git(cwd, 'push', '-u', 'origin', 'main');
  return cwd;
}

function run(script: 'uat' | 'promote', args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [`scripts/${script}.sh`, ...args], {
    cwd: mobile, env: { ...env, ...extraEnv }, encoding: 'utf8',
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'offgrid-release-e-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // A git hook exports GIT_DIR, GIT_INDEX_FILE and friends. Inherited, they point every fixture
  // command at the real repository (one push turned it bare), so the fixtures drop them.
  const outside = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/.test(key)));
  env = { ...outside, PATH: `${bin}:${process.env.PATH}`, RELEASE_BRANCH: '', SLACK_WEBHOOK_URL: '', TESTFLIGHT_EXTERNAL_GROUPS: 'Fixture testers', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  // No credentials or real uploads: these executables are the build/store/network boundary.
  writeFileSync(join(bin, 'bundle'), '#!/bin/sh\nif [ "$4" = build ]; then mkdir -p build; echo ipa > build/OffgridMobile.ipa; fi\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nif [ "$2" = download ]; then exit 1; fi\necho "$*" >> "${join(root, 'gh-calls.log')}"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'xcodebuild'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "Release fixture notes"\n', { mode: 0o755 });
  shared = repository('shared');
  mobile = repository('mobile');
  mkdirSync(join(mobile, 'scripts/lib'), { recursive: true });
  mkdirSync(join(mobile, 'fastlane'));
  mkdirSync(join(mobile, 'ios/OffgridMobile.xcodeproj'), { recursive: true });
  for (const name of ['promote.sh', 'uat.sh', 'notify-slack-release.mjs', 'lib/version.js']) {
    cpSync(join(source, 'scripts', name), join(mobile, 'scripts', name));
  }
  writeFileSync(join(mobile, 'fastlane/Fastfile'), '# Native build boundary\n');
  writeFileSync(join(mobile, 'ios/OffgridMobile.xcodeproj/project.pbxproj'), 'MARKETING_VERSION = 0.0.1;\nCURRENT_PROJECT_VERSION = 1;\n');
  writeFileSync(join(mobile, 'package.json'), `${JSON.stringify({ name: 'release-fixture', version: '0.0.1' }, null, 2)}\n`);
  git(mobile, 'add', '.');
  git(mobile, 'commit', '-m', 'Release fixture');
  git(mobile, 'push');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it('M2: publishes the tested tag when main is ahead, without changing main', () => {
  const beta = git(mobile, 'rev-parse', 'HEAD');
  git(mobile, 'tag', '-a', 'v0.0.1-beta.1', '-m', 'Beta\n\nBuild: 100');
  save(mobile, 'later.txt', 'Later work');
  git(mobile, 'push', '--tags', 'origin', 'main');
  const main = git(mobile, 'rev-parse', 'HEAD');
  const result = run('promote', ['v0.0.1-beta.1']);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
  expect(git(join(root, 'mobile-origin.git'), 'rev-parse', 'refs/heads/main')).toBe(main);
  expect(git(join(root, 'mobile-origin.git'), 'rev-parse', 'refs/tags/v0.0.1^{}')).toBe(beta);
});

it('M2: refuses a beta that is not an ancestor of origin/main', () => {
  save(mobile, 'unreleased.txt', 'Unreleased work');
  git(mobile, 'tag', '-a', 'v0.0.1-beta.1', '-m', 'Beta\n\nBuild: 100');
  const result = run('promote', ['v0.0.1-beta.1']);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('NOT on origin/main');
  expect(git(join(root, 'mobile-origin.git'), 'tag', '-l', 'v0.0.1')).toBe('');
});

it('M3: refuses a clean local commit ahead of origin/main', () => {
  save(mobile, 'unreleased.txt', 'Unreleased work');
  const result = run('uat', ['--ios']);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('HEAD must equal origin/main');
});

it('M3: refuses a clean checkout behind the current origin/main', () => {
  const oldHead = git(mobile, 'rev-parse', 'HEAD');
  save(mobile, 'later.txt', 'New main');
  git(mobile, 'push');
  git(mobile, 'checkout', '--detach', oldHead);
  const result = run('uat', ['--ios']);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('HEAD must equal origin/main');
});

it('M4: refuses dirty shared source', () => {
  writeFileSync(join(shared, 'untracked.txt'), 'Uncommitted shared change');
  const result = run('uat', ['--ios']);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('../shared is dirty');
});

it('refuses an iOS beta with no TestFlight external group before it builds anything', () => {
  const result = run('uat', ['--ios'], { TESTFLIGHT_EXTERNAL_GROUPS: '' });
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('TESTFLIGHT_EXTERNAL_GROUPS is not set');
  expect(existsSync(join(mobile, 'build/OffgridMobile.ipa'))).toBe(false);
});

it('refuses an iOS beta whose group list names no group (",,") before it builds anything', () => {
  const result = run('uat', ['--ios'], { TESTFLIGHT_EXTERNAL_GROUPS: ' , ,' });
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('names no group');
  expect(existsSync(join(mobile, 'build/OffgridMobile.ipa'))).toBe(false);
});

it('M4: refuses a clean shared commit that differs from origin/main', () => {
  save(shared, 'unreleased.txt', 'Unreleased shared change');
  const result = run('uat', ['--ios']);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('../shared HEAD must equal origin/main');
});

it('attaches the IPA that went to TestFlight to the GitHub prerelease', () => {
  const result = run('uat', ['--ios']);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  const create = readFileSync(join(root, 'gh-calls.log'), 'utf8').split('\n').find(line => line.startsWith('release create'));
  expect(create).toContain('v0.0.2-beta.1');
  expect(create).toContain('OffgridMobile-0.0.2-beta.1.ipa');
});

it.each(['', 'release/candidate'])('M3/M4: records shared source in the beta tag (explicit branch: %s)', branch => {
  if (branch) {
    git(mobile, 'checkout', '-b', branch);
    git(mobile, 'push', '-u', 'origin', branch);
    save(mobile, 'candidate.txt', 'Explicit release branch');
  }
  const result = run('uat', ['--ios'], { RELEASE_BRANCH: branch });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
  const annotation = git(join(root, 'mobile-origin.git'), 'for-each-ref', 'refs/tags/v0.0.2-beta.1', '--format=%(contents)');
  expect(annotation).toMatch(/Build: \d+\nShared: [a-f0-9]{40}/);
  expect(annotation).toContain(`Shared: ${git(shared, 'rev-parse', 'HEAD')}`);
});
