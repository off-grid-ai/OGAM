/**
 * The Android nightly's shader compiler build (scripts/video/build-shaderc.sh).
 *
 * SPEC: the script builds shaderc's command-line compiler and installs it at
 * .video-build/shaderc/bin/glslc. In shaderc's CMake, the target `glslc` is only the static library;
 * the command-line compiler is `glslc_exe`, whose binary lands at build-host/glslc/glslc. Building the
 * library target left nothing to copy, and the nightly stopped at :app:prepareVideoRuntime.
 *
 * The real script runs. Its external tools (git, python3, cmake) are the boundary: stand-ins on PATH
 * record the target asked for and leave the outputs real CMake leaves for it.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '../../scripts/video/build-shaderc.sh');

function tool(dir: string, name: string, body: string) {
  fs.writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

it('builds the command-line compiler target and installs the binary from where CMake writes it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shaderc-'));
  fs.mkdirSync(path.join(root, 'scripts/video'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/video/build-shaderc.sh'));
  const bin = path.join(root, 'tools');
  fs.mkdirSync(bin);
  const log = path.join(root, 'cmake.log');
  // git: a clone leaves a checkout; fetch and checkout succeed.
  tool(bin, 'git', 'for a in "$@"; do last="$a"; done; [ "$1" = clone ] && mkdir -p "$last/.git"; exit 0');
  tool(bin, 'python3', 'exit 0');
  // cmake: what real CMake leaves per target. glslc = the static library; glslc_exe = the compiler.
  tool(
    bin,
    'cmake',
    [
      `echo "$*" >> "${log}"`,
      'if [ "$1" = --build ]; then',
      '  build="$2"; target=""; while [ $# -gt 0 ]; do [ "$1" = --target ] && target="$2"; shift; done',
      '  mkdir -p "$build/glslc"',
      '  case "$target" in',
      '    glslc_exe) printf "#!/bin/sh\\n" > "$build/glslc/glslc"; chmod +x "$build/glslc/glslc" ;;',
      '    glslc) : > "$build/glslc/libglslc.a" ;;',
      '  esac',
      'fi',
      'exit 0',
    ].join('\n'),
  );

  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
  execFileSync('bash', [path.join(root, 'scripts/video/build-shaderc.sh')], { env, stdio: 'pipe' });

  const builds = fs.readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('--build'));
  expect(builds).toHaveLength(1);
  expect(builds[0]).toMatch(/--target glslc_exe\b/);
  const installed = path.join(root, '.video-build/shaderc/bin/glslc');
  // Installed and runnable.
  expect(() => fs.accessSync(installed, fs.constants.X_OK)).not.toThrow();
});
