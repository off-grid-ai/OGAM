/**
 * Dev-only persistent log file sink.
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
 * It is entirely behind __DEV__ (wired in App.tsx) — release builds never touch it.
 * Writes are buffered + flushed on an interval so high-frequency logging never
 * blocks the JS thread, and the file is rotated at a size cap so it can't grow
 * unbounded. Logging must NEVER throw, so every FS call is best-effort.
 */
import RNFS from 'react-native-fs';

const LOG_PATH = `${RNFS.DocumentDirectoryPath}/offgrid-debug.log`;
/** Rotate (keep the tail) once the file exceeds this, so it can't grow forever. */
const MAX_BYTES = 5 * 1024 * 1024;
const FLUSH_MS = 800;
const FLUSH_AT_LINES = 50;

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

/** The on-device path of the log file (also the `Documents/…` relative for pulls). */
export function getDebugLogPath(): string { return LOG_PATH; }

async function flush(): Promise<void> {
  timer = null;
  if (buffer.length === 0) return;
  const chunk = buffer.join('');
  buffer = [];
  try {
    await RNFS.appendFile(LOG_PATH, chunk, 'utf8');
    const stat = await RNFS.stat(LOG_PATH).catch(() => null);
    if (stat && Number(stat.size) > MAX_BYTES) {
      // Keep only the most recent half so the file stays bounded but useful.
      const content = await RNFS.readFile(LOG_PATH, 'utf8').catch(() => '');
      await RNFS.writeFile(LOG_PATH, content.slice(-Math.floor(MAX_BYTES / 2)), 'utf8').catch(() => {});
    }
  } catch {
    /* never throw from logging */
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => { flush().catch(() => {}); }, FLUSH_MS);
}

/** Begin capturing to the file. Idempotent; no-op outside __DEV__. */
export function initDebugLogFile(): void {
  if (!__DEV__ || enabled) return;
  enabled = true;
  // Append (don't wipe) a session marker so a prior session's tail survives a
  // reload/crash for post-mortem, while the size cap keeps it bounded.
  buffer.push(`\n===== session start ${new Date().toISOString()} (${LOG_PATH}) =====\n`);
  scheduleFlush();
}

/** Append one captured log line. Called from the App.tsx logger tap. */
export function appendDebugLine(level: string, message: string): void {
  if (!enabled) return;
  buffer.push(`${new Date().toISOString()} [${level}] ${message}\n`);
  if (buffer.length >= FLUSH_AT_LINES) { flush().catch(() => {}); }
  else { scheduleFlush(); }
}
