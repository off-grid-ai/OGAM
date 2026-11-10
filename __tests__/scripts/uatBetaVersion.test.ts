/**
 * Which version the next beta targets (scripts/uat.sh next_beta_target), against a real git repository
 * with the tags OGAM had on 2026-11-10: 0.0.122 promoted, 0.0.123 only ever a beta.
 *
 * Ali, 2026-11-10: a second cut of an unreleased 0.0.123 should be "0.0.123-beta.2", not 0.0.124-beta.1.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const script = readFileSync(join(__dirname, '../../scripts/uat.sh'), 'utf8');
const fn = script.slice(script.indexOf('next_beta_target() {'), script.indexOf('\n}\n', script.indexOf('next_beta_target() {')) + 2);

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'uat-version-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  for (const tag of ['v0.0.122-beta.1', 'v0.0.122', 'v0.0.123-beta.1']) git('tag', tag);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** The target and beta number uat.sh picks when package.json says `current`. */
function nextBeta(current: string): string {
  return execFileSync('bash', ['-c', `${fn}
T=$(next_beta_target "${current}" "$(git tag -l "v${current}")")
N=$(( $(git tag -l "v$T-beta.*" | sed -E 's/.*-beta\\.([0-9]+)$/\\1/' | sort -n | tail -1) + 1 ))
echo "$T-beta.$N"`], { cwd: repo, encoding: 'utf8' }).trim();
}

it('a version not yet promoted gets its next beta, not a new version', () => {
  expect(nextBeta('0.0.123')).toBe('0.0.123-beta.2');
});

it('a version promoted to production starts the next version at beta.1', () => {
  expect(nextBeta('0.0.122')).toBe('0.0.123-beta.2');
  execFileSync('git', ['tag', 'v0.0.123'], { cwd: repo });
  expect(nextBeta('0.0.123')).toBe('0.0.124-beta.1');
});
