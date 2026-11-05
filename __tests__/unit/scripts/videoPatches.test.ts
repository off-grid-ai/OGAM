/**
 * The one list of local stable-diffusion.cpp patches (scripts/video/patches.txt).
 *
 * SPEC: every patch file in scripts/video is listed once, with a tree it applies to and the
 * platforms that apply it; the Android build, the iOS build (and its build key) and the engine
 * bot's --patches-only check read the list through scripts/video/apply-patches.sh, and none of
 * them names a patch of its own. A patch left off the list is neither built nor checked before a bump.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../../..');
const VIDEO = path.join(ROOT, 'scripts/video');
const entries = fs
  .readFileSync(path.join(VIDEO, 'patches.txt'), 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const [target, patch, platforms, ...rest] = line.split(/\s+/);
    return { target, patch, platforms: platforms?.split(',') ?? [], rest };
  });
const list = (platform: string) =>
  execFileSync('bash', [path.join(VIDEO, 'apply-patches.sh'), '--list', platform], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(file => path.basename(file));

it('lists every patch in scripts/video once', () => {
  const onDisk = fs.readdirSync(VIDEO).filter(file => file.endsWith('.patch')).sort();
  expect(entries.map(e => e.patch).sort()).toEqual(onDisk);
});

it('gives each patch a tree and only known platforms', () => {
  for (const entry of entries) {
    expect(['.', 'ggml']).toContain(entry.target);
    expect(entry.platforms.length).toBeGreaterThan(0);
    for (const platform of entry.platforms) expect(['android', 'ios']).toContain(platform);
    expect(entry.rest).toEqual([]);
  }
});

it.each(['android', 'ios'])('lists the %s patches in the file order', platform => {
  expect(list(platform)).toEqual(entries.filter(e => e.platforms.includes(platform)).map(e => e.patch));
});

// Only Android's routing overlay is named outside the list: it is reversed before the list applies it again.
it.each([
  ['scripts/prepare-video-runtime.sh', ['scripts/video/android-attention-query-routing.patch']],
  ['scripts/build-video-ios.sh', []],
])('leaves %s no patch list of its own', (script, named) => {
  const source = fs.readFileSync(path.join(ROOT, script), 'utf8');
  expect(source).toContain('scripts/video/apply-patches.sh');
  expect(source.match(/scripts\/video\/[\w-]+\.patch/g) ?? []).toEqual(named);
});

it('rejects an unknown platform', () => {
  expect(() =>
    execFileSync('bash', [path.join(VIDEO, 'apply-patches.sh'), 'windows', '/tmp'], { stdio: 'pipe' }),
  ).toThrow();
});
