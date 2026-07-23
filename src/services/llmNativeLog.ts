/**
 * llama.cpp native-log passthrough.
 *
 * rnllama collapses every load failure to a generic "Failed to load model" — the
 * REAL reason (e.g. "error loading model: missing tensor blk.0.altup_proj", or
 * "unknown model architecture", or "tensor 'x' has wrong size") is written by
 * llama.cpp to its own log and otherwise lost. This enables that log ONCE, streams
 * it to our logger under [LLM-NATIVE], and keeps a small ring buffer so a load
 * failure can attach the actual reason to the error it throws. Model-load failures
 * are then never opaque again.
 */
import { toggleNativeLog, addNativeLogListener } from 'llama.rn';
import logger from '../utils/logger';

const RING_SIZE = 40;
const recent: string[] = [];
let started = false;

/** Enable llama.cpp native logging once and capture it. Safe to call repeatedly. */
export function ensureNativeLogCapture(): void {
  if (started) return;
  started = true;
  try {
    toggleNativeLog(true);
    addNativeLogListener((level: string, text: string) => {
      const line = `${(level || 'info').trim()}: ${(text || '').trim()}`;
      // Keep the native log in the ring buffer ONLY (surfaced on a load failure via
      // recentNativeLog() -> [LLM] llama.cpp native log tail). We deliberately do NOT
      // tee every native line to logger.log: llama.cpp emits load + per-generation
      // spam that floods the Debug Logs and buries our own traces. The failure reason
      // is still captured on demand; enabling the live tee is one line if ever needed.
      recent.push(line);
      if (recent.length > RING_SIZE) recent.shift();
    });
  } catch (e) {
    logger.warn('[LLM-NATIVE] could not enable native log passthrough', e);
  }
}

/** The most recent native-log lines, for attaching the real reason to a load error. */
export function recentNativeLog(n = 12): string {
  return recent.slice(-n).join('\n');
}

/** Clear the ring buffer (e.g. right before a fresh load attempt). */
export function resetNativeLogCapture(): void {
  recent.length = 0;
}
