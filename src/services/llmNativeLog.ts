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

/**
 * Lines llama.cpp emits once PER TENSOR while loading a model - hundreds to thousands of them.
 *
 * They must not reach our logger, because logger.log appends to the on-device log file: thousands of
 * file writes on the JS thread, in the middle of the load they describe. On device that starved the
 * load itself - the app looked frozen (112% CPU, no ANR) and the text model then failed with
 * "loading timed out after 120s".
 *
 * They are still kept in the ring buffer, which is the point of this passthrough: a load failure can
 * attach the real reason. The ring is memory and costs nothing; the file is what hurt.
 */
const PER_TENSOR_NOISE = /create_tensor|loading tensor|done_getting_tensors|load_tensors:/;

/**
 * Lines llama.cpp emits once PER SAMPLED TOKEN while a lazy tool grammar waits for its trigger, e.g.
 * "Grammar still awaiting trigger after token 7932 (` gift`)". They carry the reply's own words, and
 * the debug log never holds chat content (docs/ANALYTICS.md, Report a problem), so they are dropped.
 */
const PER_TOKEN_LINE = /Grammar (?:still awaiting trigger|triggered) /;
/** llama.cpp quotes token and prompt text in backticks; keep the line, never the text. */
const QUOTED_TEXT = /`[^`]*`/g;
const recent: string[] = [];
let started = false;

/** Enable llama.cpp native logging once and capture it. Safe to call repeatedly. */
export function ensureNativeLogCapture(): void {
  if (started) return;
  started = true;
  try {
    toggleNativeLog(true);
    addNativeLogListener((level: string, text: string) => {
      const severity = (level || 'info').trim();
      const raw = (text || '').trim();
      if (PER_TOKEN_LINE.test(raw)) return;
      const line = `${severity}: ${raw.replace(QUOTED_TEXT, '`…`')}`;
      // Ring every other line: this is what makes a load failure explain itself.
      recent.push(line);
      if (recent.length > RING_SIZE) recent.shift();
      // File only when it is worth a write. Anything not per-tensor still goes through, so
      // architecture errors, missing tensors and wrong sizes are as visible as they ever were.
      if (severity === 'error' || severity === 'warn' || !PER_TENSOR_NOISE.test(line)) {
        logger.log(`[LLM-NATIVE] ${line}`);
      }
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
