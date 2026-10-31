/**
 * Persistent log file sink. Report a problem sends this file to support, in every build.
 *
 * RN 0.83 moved JS console logs off the Metro terminal into React Native DevTools,
 * and RN's console never reaches the iOS device syslog — so neither `metro` stdout
 * nor `idevicesyslog` can capture what's happening on a physical device. This sink
 * mirrors every `logger.*` line (which is where all the [TTS-SM]/[GEN-SM]/[MODEL-SM]/
 * [DL-SM]/… state-machine traces go) into a file in the app container so the trace
 * can be pulled over the cable and read directly:
 *
 *   xcrun devicectl device copy from --device <udid> \
 *     --domain-type appDataContainer --domain-identifier <bundleId> \
 *     --source Documents/offgrid-debug.log --destination /tmp/offgrid-debug.log
 *
 * It runs in every build (wired in App.tsx). Log lines hold metadata only, never chat content
 * (docs/ANALYTICS.md, Report a problem). Writes are buffered + flushed on an interval so high-frequency logging never
 * blocks the JS thread, and the file is rotated at a size cap so it can't grow
 * unbounded. Logging must NEVER throw, so every FS call is best-effort.
 */
import RNFS from 'react-native-fs';
import { statFile } from './fileStat';

const LOG_PATH = `${RNFS.DocumentDirectoryPath}/offgrid-debug.log`;
/** Rotate (keep the tail) once the file exceeds this, so it can't grow forever. */
const MAX_BYTES = 5 * 1024 * 1024;
const FLUSH_MS = 800;
const FLUSH_AT_LINES = 50;

// ── Wire-capture sink (LOSSLESS) ──────────────────────────────────────────────
// A SEPARATE, append-only file for model-wire captures ([WIRE-*] / [LLM-Tools] /
// native tool-call dumps). It is NEVER rotated or size-capped, so a long
// multi-model ground-truth run can't drop the earliest captures — the whole point
// is to miss nothing. Pull it alongside the debug log; delete it manually when done.
// Dev builds only: a store build must not grow a file without bound.
const WIRE_LOG_PATH = `${RNFS.DocumentDirectoryPath}/offgrid-wire.log`;
const WIRE_CAPTURE = /\[WIRE-|\[LLM-Tools\]|tool call received/;
let wireBuffer: string[] = [];
let wireTimer: ReturnType<typeof setTimeout> | null = null;

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

/**
 * The on-device path of the log file (also the `Documents/…` relative for pulls).
 * @public — intentional diagnostic accessor, exercised by the hardening tests.
 */
export function getDebugLogPath(): string {
  return LOG_PATH;
}

/** The on-device path of the never-rotated wire-capture file (for pulls). @public */
export function getWireLogPath(): string {
  return WIRE_LOG_PATH;
}

async function flushWire(): Promise<void> {
  wireTimer = null;
  if (wireBuffer.length === 0) return;
  const chunk = wireBuffer.join('');
  wireBuffer = [];
  // Append only — no stat, no size cap, no rotation: this file must never lose a line.
  await RNFS.appendFile(WIRE_LOG_PATH, chunk, 'utf8').catch(() => {});
}

/** The flush writing now; the next one waits for it, so lines reach the file in order. */
let inFlight: Promise<void> = Promise.resolve();

function flush(): Promise<void> {
  inFlight = inFlight.then(writeBuffered).catch(() => {});
  return inFlight;
}

async function writeBuffered(): Promise<void> {
  timer = null;
  if (buffer.length === 0) return;
  const chunk = buffer.join('');
  buffer = [];
  try {
    await RNFS.appendFile(LOG_PATH, chunk, 'utf8');
    const stat = await statFile(LOG_PATH);
    if (stat && stat.size > MAX_BYTES) {
      // Keep only the most recent half so the file stays bounded but useful.
      const content = await RNFS.readFile(LOG_PATH, 'utf8').catch(() => '');
      await RNFS.writeFile(
        LOG_PATH,
        content.slice(-Math.floor(MAX_BYTES / 2)),
        'utf8',
      ).catch(() => {});
    }
  } catch {
    /* never throw from logging */
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
}

/**
 * Write everything buffered RIGHT NOW, without waiting for the flush timer.
 *
 * For a line you must not lose. The timer-based flush is scheduled work, so a step that blocks the
 * JS thread - or a process the OS is about to kill - never reaches it, and the log stops exactly
 * where the interesting part begins. That is how an 11-second main-thread block left no trace.
 */
export function flushDebugLogNow(): Promise<void> {
  if (!enabled) return Promise.resolve();
  return flush().catch(() => {});
}

/** Begin capturing to the file. Idempotent. */
export function initDebugLogFile(): void {
  if (enabled) return;
  enabled = true;
  // Append (don't wipe) a session marker so a prior session's tail survives a
  // reload/crash for post-mortem, while the size cap keeps it bounded.
  buffer.push(
    `\n===== session start ${new Date().toISOString()} (${LOG_PATH}) =====\n`,
  );
  scheduleFlush();
}

/** Stop the dev sink and release every scheduled flush. Used by app teardown and fast refresh. */
export function stopDebugLogFile(): void {
  enabled = false;
  if (timer !== null) clearTimeout(timer);
  if (wireTimer !== null) clearTimeout(wireTimer);
  timer = null;
  wireTimer = null;
  buffer = [];
  wireBuffer = [];
}

/** Append one captured log line. Called from the App.tsx logger tap. */
export function appendDebugLine(level: string, message: string): void {
  if (!enabled) return;
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  buffer.push(line);
  if (buffer.length >= FLUSH_AT_LINES) {
    flush().catch(() => {});
  } else {
    scheduleFlush();
  }
  // Tee model-wire captures into the lossless, never-rotated file so a long capture
  // run can't drop the earliest lines.
  if (__DEV__ && WIRE_CAPTURE.test(message)) {
    wireBuffer.push(line);
    if (wireBuffer.length >= 20) {
      flushWire().catch(() => {});
    } else if (!wireTimer) {
      wireTimer = setTimeout(() => {
        flushWire().catch(() => {});
      }, FLUSH_MS);
    }
  }
}
