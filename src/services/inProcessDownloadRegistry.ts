/**
 * Registry of downloads driven by an in-process JS loop rather than the native download manager —
 * multi-file image downloads (per-file transfers) and the zip unzip/finalize window. These transfers
 * are REAL and in-flight, but they have NO single native download row while running, so the hydration
 * strand path (downloadHydration.ts) cannot use "native row present?" to know they are still alive.
 *
 * A foreground resume must NOT mark such a live transfer as failed. This registry is the liveness
 * signal it consults instead. It is process-local module state, so it is naturally EMPTY on a cold
 * start (a fresh process has no running loop) — which is exactly correct: a persisted active entry
 * with no live loop after an app-kill IS stranded (retriable), while one still running across a mere
 * background→foreground transition is left alone.
 *
 * Keyed by the download's ModelKey (the same key space the store and hydration use).
 */
const liveKeys = new Set<string>();

/** Mark a JS-driven transfer as live in this process. Call when the loop starts. */
export function markDownloadInProcess(modelKey: string): void {
  liveKeys.add(modelKey);
}

/** Clear the mark when the loop finishes, fails, or is cancelled (call from a finally). */
export function clearDownloadInProcess(modelKey: string): void {
  liveKeys.delete(modelKey);
}

/** True while a JS-driven transfer for this key is running in the current process. */
export function isDownloadInProcess(modelKey: string): boolean {
  return liveKeys.has(modelKey);
}
