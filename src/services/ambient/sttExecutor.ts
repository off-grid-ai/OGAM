/**
 * The transcription seam for the ambient recorder — one interface, two interchangeable executors.
 *
 * The scheduler decides WHERE a segment should transcribe ('phone' | 'mac'); this actually runs it,
 * behind a single `SttExecutor` interface so callers never branch on which one. Two concrete impls
 * plug in later: on-device whisper, and Mac offload over the Tailscale mesh (bigger model, zero phone
 * battery). `dispatchStt` routes a job to the requested executor and — because the Mac is an
 * accelerator, never a hard dependency — falls back to the phone if the Mac path is missing or fails.
 * So a dropped mesh mid-run degrades to on-device instead of losing the segment.
 *
 * Native-free: whisper and the offload HTTP call live inside the concrete executors; this only routes
 * and handles fallback, so the policy is unit-testable with fakes.
 */

export type SttExecutorName = 'phone' | 'mac'

export interface SttInput {
  segmentId: string
  /** The continuous recording file the segment indexes into. */
  recordingPath: string
  startMs: number
  endMs: number
}

/** One interchangeable transcription backend. Implementations must not throw for a normal empty
 *  result — throwing means "this backend could not run", which triggers fallback. */
export interface SttExecutor {
  transcribe(input: SttInput): Promise<{ text: string }>
}

export interface SttDispatchDeps {
  phone: SttExecutor
  /** Present only while the Mac is reachable over the mesh. Absent = phone-only. */
  mac?: SttExecutor
}

export type SttResult =
  | { segmentId: string; ok: true; text: string; executor: SttExecutorName }
  | { segmentId: string; ok: false; error: string }

export interface SttJob {
  segmentId: string
  executor: SttExecutorName
}

export async function dispatchStt(
  job: SttJob,
  input: SttInput,
  deps: SttDispatchDeps
): Promise<SttResult> {
  // Mac-first when requested, then always the phone as the safety net.
  const order: SttExecutorName[] = job.executor === 'mac' ? ['mac', 'phone'] : ['phone']
  let lastError = 'no transcription backend available'
  for (const name of order) {
    const executor = name === 'mac' ? deps.mac : deps.phone
    if (!executor) {
      lastError = `${name} transcription backend unavailable`
      continue
    }
    try {
      const { text } = await executor.transcribe(input)
      return { segmentId: job.segmentId, ok: true, text, executor: name }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return { segmentId: job.segmentId, ok: false, error: lastError }
}
