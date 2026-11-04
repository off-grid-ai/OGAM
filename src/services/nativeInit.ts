/**
 * Watches one native model load (llama.rn `initLlama`) and says WHY it did not finish.
 *
 * A flat "45 seconds for everything" cannot tell a 7 GB model that is still reading its weights from storage apart
 * from a GPU driver that hung, so a healthy slow load was cut off exactly like a hang. llama.rn reports weight loading
 * as a percentage; this watchdog uses it:
 *   - while the weights are loading, the load is alive as long as the percentage keeps moving (stalled = no movement
 *     for `stallMs`);
 *   - once the weights are in (100%), the GPU still has to compile kernels and allocate buffers, which reports nothing:
 *     that phase gets its own window (`setupMs`);
 *   - nothing runs past `hardCapMs`.
 * The error names the phase, the last percentage and the elapsed time, so a log shows memory/storage trouble (stuck
 * mid-percentage) apart from a GPU runtime hang (100% then silence).
 *
 * A timed-out native load cannot be cancelled from JS: it keeps running and its context must be released when it
 * finishes. `trackAbandonedInit` remembers it, and `settleAbandonedInit` makes the NEXT load wait until it is gone, so
 * two multi-gigabyte loads never run side by side.
 */
import logger from '../utils/logger';

export type InitPhase = 'loading-weights' | 'gpu-setup';

export interface InitTrace {
  startedAt: number;
  phase: InitPhase;
  /** Weight-loading percentage last reported (0 until the first report). */
  percent: number;
  /** When the percentage (or the phase) last changed. */
  movedAt: number;
  /** [percent, ms since start] each time the percentage moved. */
  samples: Array<[number, number]>;
}

export interface InitWindows {
  /** Weights loading: no percentage movement for this long means stalled. */
  stallMs: number;
  /** After the weights are loaded: how long GPU setup may take. */
  setupMs: number;
  /** Absolute limit. */
  hardCapMs: number;
}

export const DEFAULT_INIT_WINDOWS: InitWindows = { stallMs: 45_000, setupMs: 90_000, hardCapMs: 300_000 };
/** How long the next load waits for an abandoned one to finish before refusing to start. */
export const ABANDONED_SETTLE_MS = 120_000;

export function startInitTrace(now: number = Date.now()): InitTrace {
  return { startedAt: now, phase: 'loading-weights', percent: 0, movedAt: now, samples: [] };
}

/** Records a weight-loading percentage; 100 means the weights are in and GPU setup begins. */
export function recordInitProgress(trace: InitTrace, percent: number, now: number = Date.now()): void {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const phase: InitPhase = pct >= 100 ? 'gpu-setup' : 'loading-weights';
  if (pct === trace.percent && phase === trace.phase) return;
  trace.percent = Math.max(trace.percent, pct);
  trace.phase = phase;
  trace.movedAt = now;
  trace.samples.push([trace.percent, now - trace.startedAt]);
}

/** Which window ran out, or null while the load is still within its limits. */
export function initVerdict(trace: InitTrace, windows: InitWindows, now: number): { windowMs: number; reason: string } | null {
  const total = now - trace.startedAt;
  if (total >= windows.hardCapMs) return { windowMs: windows.hardCapMs, reason: `${seconds(total)} in total with the load still unfinished (hard limit)` };
  const quiet = now - trace.movedAt;
  if (trace.phase === 'loading-weights' && quiet >= windows.stallMs) {
    return { windowMs: windows.stallMs, reason: `weights stopped loading at ${trace.percent}% (no movement for ${seconds(quiet)}, ${seconds(total)} since the load began)` };
  }
  if (trace.phase === 'gpu-setup' && quiet >= windows.setupMs) {
    return { windowMs: windows.setupMs, reason: `weights are loaded (100% after ${seconds(trace.movedAt - trace.startedAt)}) but GPU setup has not finished in ${seconds(quiet)}` };
  }
  return null;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Resolves with the load's result, or rejects once the load has stalled. The message keeps the
 * "<label> timed out after <n>ms" form other code matches on, and appends the diagnosis.
 */
export function watchInit<T>(promise: Promise<T>, trace: InitTrace, opts: { label: string; windows?: InitWindows; pollMs?: number }): Promise<T> {
  const { label, windows = DEFAULT_INIT_WINDOWS, pollMs = 1000 } = opts;
  return new Promise<T>((resolve, reject) => {
    const timer = setInterval(() => {
      const verdict = initVerdict(trace, windows, Date.now());
      if (!verdict) return;
      clearInterval(timer);
      reject(new Error(`${label} timed out after ${verdict.windowMs}ms: ${verdict.reason}`));
    }, pollMs);
    promise.then(
      (value) => { clearInterval(timer); resolve(value); },
      (error) => { clearInterval(timer); reject(error); },
    );
  });
}

/** One-line summary of a trace for logs: where the percentage was at each step. */
export function describeTrace(trace: InitTrace, now: number = Date.now()): string {
  const steps = trace.samples.map(([pct, ms]) => `${pct}%@${seconds(ms)}`).join(' ');
  return `phase=${trace.phase} percent=${trace.percent} elapsed=${seconds(now - trace.startedAt)} steps=[${steps || 'none reported'}]`;
}

// ---- A load that timed out and is still running natively -------------------------------------------------------

let abandoned: { done: boolean; startedAt: number; promise: Promise<void> } | null = null;

/**
 * Remembers a timed-out load until it finishes; `release` frees the context it produces (if any). Resolves once that
 * has happened, whichever way the load ended.
 */
export function trackAbandonedInit<T>(promise: Promise<T>, release: (value: T) => Promise<void>): void {
  const entry = { done: false, startedAt: Date.now(), promise: Promise.resolve() };
  entry.promise = promise
    .then((value) => release(value))
    .catch(() => undefined)
    .then(() => { entry.done = true; if (abandoned === entry) abandoned = null; });
  abandoned = entry;
}

export const hasAbandonedInit = (): boolean => !!abandoned && !abandoned.done;

/**
 * Waits for a timed-out load to finish and release its context before another load starts. Throws a readable error
 * when it is still stuck after `maxWaitMs`: starting a second multi-gigabyte load next to a wedged one risks the
 * system killing the app, so the person is told to restart Atlas instead.
 */
export async function settleAbandonedInit(maxWaitMs: number = ABANDONED_SETTLE_MS): Promise<void> {
  const entry = abandoned;
  if (!entry || entry.done) return;
  logger.warn(`[LLM] A GPU load that timed out is still running natively (${seconds(Date.now() - entry.startedAt)} so far); waiting for it to finish before loading again`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = await Promise.race([
    entry.promise.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), maxWaitMs); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!finished) {
    throw new Error(`The GPU is still busy with an earlier load that never finished (${seconds(Date.now() - entry.startedAt)}). Close Atlas completely and open it again, then retry; loading again now could make Android close the app.`);
  }
  logger.log('[LLM] The earlier GPU load finished and was released; continuing');
}

/** For tests: forget any abandoned load. */
export function resetAbandonedInit(): void { abandoned = null; }
