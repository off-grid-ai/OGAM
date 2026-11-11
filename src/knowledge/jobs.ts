/**
 * Only one learning job at a time. Two overlapping jobs would interleave writes to the same index shards and checkpoints, so a
 * second request while one runs is refused with a clear message instead of racing it. The in-memory flag covers the running app;
 * the lock file (refreshed on every batch) records the running job for diagnostics and is replaced after a crash.
 */
import { P, atomicWriteText, nowIso, removeTree } from './storage';

let active: string | null = null;
export const activeJob = (): string | null => active;

export async function withJobLock<T>(name: string, fn: (heartbeat: () => Promise<void>) => Promise<T>): Promise<T> {
  if (active) throw new Error(`Another learning job is already running (${active}). Wait for it to finish or pause it.`);
  // A lock file left by a job from before the app was killed is stale by definition (nothing is running here), so it is simply replaced.
  active = name;
  const beat = () => atomicWriteText(P.lock(), JSON.stringify({ name, at: nowIso() }));
  try {
    await beat();
    return await fn(beat);
  } finally {
    active = null;
    await removeTree(P.lock()).catch(() => undefined);
  }
}
