/**
 * A video model pack that no backend can open names stable-diffusion.cpp's reason.
 *
 * SPEC (community report, 2026-11-03): video generation failed with "The model failed to load: Could not
 * load the video model pack." and nothing else: new_sd_ctx returns null and says why only in sd.cpp's log,
 * which Android release builds did not even read. The bindings now pass every sd.cpp log line to the
 * runtime's EngineErrorLog, and the failed load's message carries the last error.
 *
 * The header is the shipped C++ (native/video/common/EngineErrorLog.hpp), compiled here by the host
 * compiler and driven the way the bindings drive it: log lines in, as sd.cpp emits them, then the message.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HEADER_DIR = path.join(__dirname, '../../../native/video/common');

/** 'attempt' is the runtime starting its next backend (NPU, then GPU, then CPU on Android). */
type Level = 'error' | 'warn' | 'debug' | 'attempt';

/** Feed `lines` to a fresh log, as sd.cpp emits them, then return what a failed load would say. */
function failedLoadMessage(lines: Array<[Level, string] | ['attempt']>): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-error-log-'));
  const notes = lines
    .map(([level, text]) => level === 'attempt'
      ? '  log.clear();'
      : `  log.note(${level === 'error'}, ${level === 'warn'}, ${JSON.stringify(text)});`)
    .join('\n');
  const source = `#include "EngineErrorLog.hpp"
#include <iostream>
int main() {
  offgrid::EngineErrorLog log;
${notes}
  std::cout << log.takeLoadFailure() << "|" << log.takeLoadFailure();
}
`;
  fs.writeFileSync(path.join(folder, 'driver.cpp'), source);
  const binary = path.join(folder, 'driver');
  execFileSync('c++', ['-std=c++17', '-I', HEADER_DIR, path.join(folder, 'driver.cpp'), '-o', binary]);
  const [message, next] = execFileSync(binary, { encoding: 'utf8' }).split('|');
  expect(next).toBe('Could not load the video model pack.'); // one load's reason never leaks into the next
  return message;
}

// What a OnePlus SM8635 logged for a Wan 2.1 pack whose weight header was damaged (2026-11-03).
const PACK = '/data/user/0/ai.offgridmobile.dev/files/video-models/off-grid-ai%2FWan2.1-T2V-1.3B-GGUF-Q4';

it('names the file it could not read, and says to download the model again', () => {
  expect(failedLoadMessage([
    ['debug', `loading diffusion model from '${PACK}/Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf' --- diffusion_engine.cpp:740\n`],
    ['warn', `loading diffusion model from '${PACK}/Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf' failed --- diffusion_engine.cpp:765\n`],
    ['error', "get sd version from file failed: '' --- diffusion_engine.cpp:972\n"],
  ])).toBe(
    'The video model pack has a file that cannot be read: Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf. ' +
    'Delete the model, then download it again.',
  );
});

it('names the last engine error, without its source location, when no file was named', () => {
  expect(failedLoadMessage([
    ['error', 'load tensors from model loader failed --- diffusion_engine.cpp:1012\n'],
  ])).toBe('Could not load the video model pack: load tensors from model loader failed');
});

it('says memory, and what to do, when the engine could not allocate', () => {
  expect(failedLoadMessage([
    ['warn', `loading diffusion model from '${PACK}/Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf' failed\n`],
    ['error', 'ggml_vulkan: Device memory allocation of size 3221225472 failed.\n'],
  ])).toBe(
    'Not enough free memory to load the video model pack. Close other apps, then try again. ' +
    '(ggml_vulkan: Device memory allocation of size 3221225472 failed.)',
  );
});

it('keeps the memory advice when sd.cpp logs a vaguer error after the allocation', () => {
  expect(failedLoadMessage([
    ['error', 'ggml_vulkan: Device memory allocation of size 3221225472 failed.\n'],
    ['error', 'read tensor data failed: too less memory for conversion\n'],
  ])).toBe(
    'Not enough free memory to load the video model pack. Close other apps, then try again. ' +
    '(ggml_vulkan: Device memory allocation of size 3221225472 failed.)',
  );
});

it('does not read a file name with "alloc" in it as a memory failure', () => {
  expect(failedLoadMessage([
    ['error', "failed to open '/models/allocator-test/wan.gguf' with GGUFReader\n"],
    ['warn', "loading diffusion model from '/models/allocator-test/wan.gguf' failed\n"],
  ])).toBe('The video model pack has a file that cannot be read: wan.gguf. Delete the model, then download it again.');
});

it('names what the last backend hit, not an earlier one', () => {
  expect(failedLoadMessage([
    ['attempt'],
    ['error', 'ggml_vulkan: Device memory allocation of size 3221225472 failed.\n'],
    ['attempt'],
    ['warn', `loading diffusion model from '${PACK}/Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf' failed\n`],
  ])).toBe(
    'The video model pack has a file that cannot be read: Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf. ' +
    'Delete the model, then download it again.',
  );
});

it('keeps the plain message when the engine logged no error, and never keeps a line with the prompt', () => {
  expect(failedLoadMessage([
    ['debug', 'auto-fit: diffusion model on Vulkan0\n'],
    ['error', 'prompt "a baby boy playing in the garden" too long\n'],
  ])).toBe('Could not load the video model pack.');
});
