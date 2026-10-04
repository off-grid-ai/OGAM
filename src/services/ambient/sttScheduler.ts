/**
 * Deferred transcription scheduler for the 24/7 ambient recorder — a PURE policy.
 *
 * The recorder is consume-later, not real-time, so we don't transcribe every segment the instant it
 * closes — that would cook the phone's battery all day. Instead segments queue, and this decides, per
 * run, WHICH pending segments to transcribe now and WHERE:
 *   - protect the battery: when it's low and unplugged, wait (a flagged "remember this" moment still
 *     goes through, because the user explicitly asked for it);
 *   - prefer the Mac when it's reachable over Tailscale (bigger whisper model, zero phone battery),
 *     otherwise fall back to on-device whisper so the recorder always works standalone;
 *   - bound each burst to maxBatch, drop segments that have failed too many times.
 *
 * Pure and import-free: capture, storage, and the actual whisper/offload calls live elsewhere and
 * just hand this the queue + device conditions. Same discipline as the VAD segmenter.
 */

export type SttExecutor = 'phone' | 'mac'

export interface PendingSegment {
  id: string
  /** Monotonic segment start — used to transcribe oldest-first so the timeline fills in order. */
  startMs: number
  /** Failed transcription attempts so far. */
  attempts: number
  /** A user-flagged ("remember this") segment jumps the queue and beats the battery gate. */
  flagged?: boolean
}

export interface DeviceConditions {
  /** 0..1. */
  batteryLevel: number
  charging: boolean
  /** Mac reachable over the Tailscale/LAN mesh right now. */
  macReachable: boolean
}

export interface SttSchedulerConfig {
  /** Below this level, only transcribe while charging (or for flagged segments). */
  lowBatteryLevel: number
  /** Max segments dispatched per run, to bound burst length. */
  maxBatch: number
  /** Give up on a segment after this many failed attempts. */
  maxAttempts: number
}

export const DEFAULT_STT_SCHEDULER_CONFIG: SttSchedulerConfig = {
  lowBatteryLevel: 0.2,
  maxBatch: 8,
  maxAttempts: 3
}

export interface SttJob {
  segmentId: string
  executor: SttExecutor
}

export interface TranscriptionPlan {
  jobs: SttJob[]
  /** True when work exists but conditions say wait (e.g. low battery). */
  deferred: boolean
  reason?: 'low-battery' | 'nothing-pending'
}

export function planTranscription(
  pending: readonly PendingSegment[],
  device: DeviceConditions,
  config: SttSchedulerConfig = DEFAULT_STT_SCHEDULER_CONFIG
): TranscriptionPlan {
  const eligible = pending.filter((segment) => segment.attempts < config.maxAttempts)
  if (eligible.length === 0) return { jobs: [], deferred: false, reason: 'nothing-pending' }

  // Protect the battery: low + unplugged means wait, except for flagged moments the user
  // explicitly asked to keep.
  const lowAndUnplugged = !device.charging && device.batteryLevel < config.lowBatteryLevel
  const candidates = lowAndUnplugged ? eligible.filter((segment) => segment.flagged) : eligible
  if (candidates.length === 0) return { jobs: [], deferred: true, reason: 'low-battery' }

  const executor: SttExecutor = device.macReachable ? 'mac' : 'phone'
  const ordered = [...candidates].sort(orderSegments).slice(0, config.maxBatch)
  return { jobs: ordered.map((segment) => ({ segmentId: segment.id, executor })), deferred: false }
}

/** Flagged first, then oldest-first so the day's timeline fills in chronological order. */
function orderSegments(a: PendingSegment, b: PendingSegment): number {
  if (Boolean(a.flagged) !== Boolean(b.flagged)) return a.flagged ? -1 : 1
  return a.startMs - b.startMs
}
