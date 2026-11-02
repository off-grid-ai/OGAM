/**
 * CI's ccache route for Xcode builds (scripts/xcode-ccache.sh).
 *
 * SPEC: the script writes clang and clang++ wrappers and an xcconfig that points CC and CXX at them.
 * A wrapper runs ccache with the compiler and the arguments Xcode gave it, the cache directory the
 * cache step saves, and React Native's ccache settings, from no environment of its own: Xcode does
 * not pass build settings such as CCACHE_BINARY to the compiler, so React Native's wrapper ran
 * plain clang and the cache stayed empty.
 *
 * The real script runs, and so does the wrapper it writes. ccache is the boundary: a stand-in on
 * PATH records what it was run with.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '../../scripts/xcode-ccache.sh');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-ccache-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/xcode-ccache.sh'));
  const config = path.join(root, 'node_modules/react-native/scripts/xcode/ccache.conf');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, 'sloppiness = modules\n');
  const bin = path.join(root, 'tools');
  fs.mkdirSync(bin);
  const log = path.join(root, 'ccache.log');
  fs.writeFileSync(
    path.join(bin, 'ccache'),
    `#!/bin/sh\nprintf '%s|%s|%s\\n' "$CCACHE_DIR" "$CCACHE_CONFIGPATH" "$*" >> "${log}"\n`,
    { mode: 0o755 },
  );
  return { root, bin, log, config };
}

const run = (root: string, out: string, env: NodeJS.ProcessEnv) =>
  execFileSync('bash', [path.join(root, 'scripts/xcode-ccache.sh'), out], { env, stdio: 'pipe' });

it('the xcconfig routes CC and CXX through wrappers that run ccache with the compiler, cache and settings', () => {
  const { root, bin, log, config } = project();
  const out = path.join(root, 'out');
  const cacheDir = path.join(root, 'cache');
  run(root, out, { PATH: `${bin}:/usr/bin:/bin`, CCACHE_DIR: cacheDir });

  const settings = Object.fromEntries(
    fs
      .readFileSync(path.join(out, 'ccache.xcconfig'), 'utf8')
      .trim()
      .split('\n')
      .map(line => line.split(' = ')),
  );
  // As Xcode runs the compiler: none of the CI step's environment, the arguments of one compile.
  execFileSync(settings.CC, ['-x', 'c', '-c', 'a.c'], { env: { PATH: '/usr/bin:/bin' } });
  execFileSync(settings.CXX, ['-x', 'c++', '-c', 'b.cpp'], { env: { PATH: '/usr/bin:/bin' } });

  expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toEqual([
    `${cacheDir}|${config}|clang -x c -c a.c`,
    `${cacheDir}|${config}|clang++ -x c++ -c b.cpp`,
  ]);
});

it('stops without ccache or a cache directory, rather than writing wrappers that cache nothing', () => {
  const { root, bin } = project();
  const out = path.join(root, 'out');
  expect(() => run(root, out, { PATH: `${bin}:/usr/bin:/bin` })).toThrow(/CCACHE_DIR/);
  fs.rmSync(path.join(bin, 'ccache'));
  expect(() => run(root, out, { PATH: `${bin}:/usr/bin:/bin`, CCACHE_DIR: root })).toThrow(/ccache is not installed/);
  expect(fs.existsSync(path.join(out, 'ccache.xcconfig'))).toBe(false);
});
