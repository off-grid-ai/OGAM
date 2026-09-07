/**
 * One deferred-transcription pass for the ambient recorder — the glue that turns the pure policies
 * into work. It reads the pending segment queue, asks the scheduler what to run now (battery/mesh
 * aware), dispatches each job through the executor seam (Mac-when-reachable, phone fallback), and
 * writes transcripts back — bumping the attempt count on failure so the retry cap eventually gives up.
 *
 * Composition only: the queue/persistence (AmbientSegmentStore) and the concrete whisper/offload
 * backends are injected, so a pass is unit-testable end-to-end with fakes. Something outside triggers
 * a pass (a background task on charge/idle) — this just runs one.
 */

import {
  planTranscription,
  type DeviceConditions,
  type PendingSegment,
  type SttSchedulerConfig
} from './sttScheduler'
import { dispatchStt, type SttDispatchDeps, type SttInput } from './sttExecutor'

/** Persistence the runner needs. Concrete impl (op-store/SQLite + files) plugs in later. */
export interface AmbientSegmentStore {
  /** Segments captured but not yet transcribed. */
  pending(): Promise<PendingSegment[]>
  /** The audio reference for a segment, or null if the recording is gone. */
  input(segmentId: string): Promise<SttInput | null>
  saveTranscript(segmentId: string, text: string): Promise<void>
  /** Record a failed attempt so the scheduler's retry cap can eventually drop it. */
  markAttempt(segmentId: string): Promise<void>
}

export interface AmbientRunnerDeps {
  store: AmbientSegmentStore
  /** Live device state at run time (battery, charging, mesh reachability). */
  device: () => Promise<DeviceConditions>
  /** The backends available right now (phone always; mac only while the mesh is up). */
  executors: () => SttDispatchDeps
  config?: SttSchedulerConfig
}

export interface RunSummary {
  transcribed: number
  failed: number
  /** True when the scheduler said wait (e.g. low battery) — nothing was attempted. */
  deferred: boolean
}

export async function runTranscriptionPass(deps: AmbientRunnerDeps): Promise<RunSummary> {
  const pending = await deps.store.pending()
  const device = await deps.device()
  const plan = planTranscription(pending, device, deps.config)
  if (plan.deferred || plan.jobs.length === 0) {
    return { transcribed: 0, failed: 0, deferred: plan.deferred }
  }

  const executors = deps.executors()
  let transcribed = 0
  let failed = 0
  for (const job of plan.jobs) {
    const input = await deps.store.input(job.segmentId)
    if (!input) {
      // Recording gone (retention/cleanup) — count the attempt so it stops being scheduled.
      await deps.store.markAttempt(job.segmentId)
      failed += 1
      continue
    }
    const result = await dispatchStt(job, input, executors)
    if (result.ok) {
      await deps.store.saveTranscript(job.segmentId, result.text)
      transcribed += 1
    } else {
      await deps.store.markAttempt(job.segmentId)
      failed += 1
    }
  }
  return { transcribed, failed, deferred: false }
}
