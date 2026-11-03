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

/** Feed `lines` ([isError, text]) to a fresh log, then return what a failed load would say. */
function failedLoadMessage(lines: Array<[boolean, string]>): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-error-log-'));
  const notes = lines.map(([error, text]) => `  log.note(${error}, ${JSON.stringify(text)});`).join('\n');
  const source = `#include "EngineErrorLog.hpp"
#include <iostream>
int main() {
  offgrid::EngineErrorLog log;
${notes}
  std::cout << offgrid::videoPackLoadFailure(log.take());
  std::cout << "|" << log.take().size();
}
`;
  fs.writeFileSync(path.join(folder, 'driver.cpp'), source);
  const binary = path.join(folder, 'driver');
  execFileSync('c++', ['-std=c++17', '-I', HEADER_DIR, path.join(folder, 'driver.cpp'), '-o', binary]);
  const [message, leftAfterTake] = execFileSync(binary, { encoding: 'utf8' }).split('|');
  expect(leftAfterTake).toBe('0'); // one load's reason never leaks into the next
  return message;
}

it('names the last engine error when the pack cannot be opened', () => {
  expect(failedLoadMessage([
    [false, 'loading diffusion model from /models/wan/wan2.2-ti2v-5b-Q4_K.gguf\n'],
    [true, "tensor 'blocks.0.attn.q.weight' has wrong shape in model file\n"],
    [true, 'load tensors from model loader failed\n'],
  ])).toBe('Could not load the video model pack: load tensors from model loader failed');
});

it('says memory, and what to do, when the engine could not allocate', () => {
  expect(failedLoadMessage([
    [true, 'ggml_vulkan: Device memory allocation of size 3221225472 failed.\n'],
  ])).toBe(
    'Not enough free memory to load the video model pack. Close other apps, then try again. ' +
    '(ggml_vulkan: Device memory allocation of size 3221225472 failed.)',
  );
});

it('keeps the plain message when the engine logged no error, and never keeps a line with the prompt', () => {
  expect(failedLoadMessage([
    [false, 'auto-fit: diffusion model on Vulkan0\n'],
    [true, 'prompt "a baby boy playing in the garden" too long\n'],
  ])).toBe('Could not load the video model pack.');
});
