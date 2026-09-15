/**
 * The ambient capture state machine, shared by any surface that records.
 *
 * Owns one recording lifecycle: start the mic, collect live VAD segments, let the user flag moments,
 * and on stop run the build - transcribe -> summarise -> write to the day store.
 *
 * Singleton by design: the recorder, the capture buffers, AND the reactive state live at MODULE level
 * (state in a small zustand store), not inside the screen. So a recording started on the Day screen
 * keeps running - and stays controllable + visible - after you navigate away (e.g. to Home), lock the
 * phone, or come back. Any surface can read the phase (see useAmbientRecordingPhase) to show a live
 * "recording..." indicator.
 */

import { create } from 'zustand'
import { triggerHaptic } from '../utils/haptics'
import { createAmbientRecorder } from '../services/ambient/ambientRecorderFactory'
import { ensureAmbientSliceDir } from '../services/ambient/phoneSttExecutorFactory'
import { createDefaultTimelineBuildDeps } from '../services/ambient/timelineBuilderFactory'
import { buildTimelineSessions, type BuildProgress } from '../services/ambient/timelineBuilder'
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts'
import { macOffloadReady } from '../services/ambient/macSttExecutorFactory'
import { processOnStop } from '../services/ambient/processingModel'
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore'
import type { AmbientRecorder } from '../services/ambient/ambientRecorder'
import type { SpeechSegment } from '../services/ambient/vadSegmenter'

export type CapturePhase = 'idle' | 'recording' | 'processing'

export interface AmbientCapture {
  phase: CapturePhase
  recording: boolean
  processing: boolean
  liveCount: number
  elapsedMs: number
  flagCount: number
  progress: BuildProgress | null
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  flag: () => void
  /** Process everything queued in nightly mode, then clear the queue. */
  processPending: () => Promise<void>
}

interface CaptureStoreState {
  phase: CapturePhase
  liveCount: number
  elapsedMs: number
  flagCount: number
  progress: BuildProgress | null
  error: string | null
}

/** Module-level reactive state - one recording for the whole app, independent of any screen. */
const useCaptureStore = create<CaptureStoreState>()(() => ({
  phase: 'idle',
  liveCount: 0,
  elapsedMs: 0,
  flagCount: 0,
  progress: null,
  error: null
}))
const setCapture = (patch: Partial<CaptureStoreState>): void => useCaptureStore.setState(patch)

// Module-level recorder + capture buffers, so navigation (which unmounts the screen) never orphans them.
let recorder: AmbientRecorder | null = null
let segments: SpeechSegment[] = []
let startedAt = 0
let anchors: number[] = []
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function startElapsedTimer(): void {
  stopElapsedTimer()
  setCapture({ elapsedMs: Date.now() - startedAt })
  elapsedTimer = setInterval(() => setCapture({ elapsedMs: Date.now() - startedAt }), 1000)
}
function stopElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

/**
 * Can a capture be transcribed right now? Either the phone's own transcriber is ready, OR Mac offload
 * is turned on, permitted (not on-device-only), and a paired Mac is reachable to do it - so a user who
 * offloads to the Mac and has no local model still records fine.
 */
function captureTranscriptionReady(): boolean {
  if (mobileSpeechInputPorts.transcriber.ready()) return true
  const s = useAmbientTimelineStore.getState()
  return s.useMacForTranscription && !s.onDeviceOnly && macOffloadReady()
}

// Transcribe + summarise one capture and write it to the day store. Shared by live stop + the
// deferred (nightly) queue, so both take exactly the same path.
async function buildAndStore(
  segs: SpeechSegment[],
  recordingPath: string,
  captureStartedAtMs: number,
  anchorsMs: number[]
): Promise<void> {
  await ensureAmbientSliceDir()
  const built = await buildTimelineSessions(
    segs,
    recordingPath,
    captureStartedAtMs,
    {
      ...createDefaultTimelineBuildDeps(
        useAmbientTimelineStore.getState().onDeviceOnly,
        useAmbientTimelineStore.getState().useMacForTranscription
      ),
      onProgress: progress => setCapture({ progress })
    },
    anchorsMs
  )
  useAmbientTimelineStore.getState().addSessions(built)
}

async function processPending(): Promise<void> {
  const pending = useAmbientTimelineStore.getState().pendingCaptures
  if (pending.length === 0) return
  if (!captureTranscriptionReady()) {
    setCapture({ error: 'Set up a transcription model in Models (or pair a Mac) to process recordings.' })
    return
  }
  setCapture({ phase: 'processing', progress: { phase: 'transcribing', done: 0, total: 1 } })
  try {
    for (const capture of pending) {
      await buildAndStore(capture.segments, capture.recordingPath, capture.captureStartedAtMs, capture.anchorsMs)
    }
    useAmbientTimelineStore.getState().clearPendingCaptures()
  } catch (e) {
    setCapture({ error: e instanceof Error ? e.message : 'Could not process the recordings.' })
  } finally {
    setCapture({ phase: 'idle', progress: null })
  }
}

function flag(): void {
  if (useCaptureStore.getState().phase !== 'recording') return
  anchors = [...anchors, Date.now() - startedAt]
  setCapture({ flagCount: anchors.length })
  triggerHaptic('impactMedium')
}

async function start(): Promise<void> {
  if (useCaptureStore.getState().phase !== 'idle') return
  setCapture({ error: null, liveCount: 0, flagCount: 0, elapsedMs: 0 })
  segments = []
  anchors = []
  startedAt = Date.now()
  const rec = createAmbientRecorder()
  recorder = rec
  try {
    await rec.start(segment => {
      segments = [...segments, segment]
      setCapture({ liveCount: segments.length })
    })
    setCapture({ phase: 'recording' })
    startElapsedTimer()
  } catch (e) {
    recorder = null
    setCapture({ error: e instanceof Error ? e.message : 'Could not start recording.' })
  }
}

async function stop(): Promise<void> {
  stopElapsedTimer()
  let result: { path: string; durationSeconds: number } | null = null
  try {
    result = (await recorder?.stop()) ?? null
  } finally {
    recorder = null
  }
  const captured = segments
  const capturedStartedAt = startedAt
  const capturedAnchors = anchors
  if (!result || captured.length === 0) {
    setCapture({ phase: 'idle' })
    return
  }
  // Nightly mode: queue the capture for a later pass instead of processing now.
  if (!processOnStop(useAmbientTimelineStore.getState().processingMode)) {
    useAmbientTimelineStore.getState().addPendingCapture({
      id: String(capturedStartedAt),
      segments: captured,
      recordingPath: result.path,
      captureStartedAtMs: capturedStartedAt,
      anchorsMs: capturedAnchors
    })
    setCapture({ phase: 'idle' })
    return
  }
  if (!captureTranscriptionReady()) {
    setCapture({
      error: 'Set up a transcription model in Models, or pair a Mac and grant its tools, then record.',
      phase: 'idle'
    })
    return
  }
  setCapture({ phase: 'processing', progress: { phase: 'transcribing', done: 0, total: 1 } })
  try {
    await buildAndStore(captured, result.path, capturedStartedAt, capturedAnchors)
  } catch (e) {
    setCapture({ error: e instanceof Error ? e.message : 'Could not process the recording.' })
  } finally {
    setCapture({ phase: 'idle', progress: null })
  }
}

export function useAmbientCapture(): AmbientCapture {
  const s = useCaptureStore()
  return {
    phase: s.phase,
    recording: s.phase === 'recording',
    processing: s.phase === 'processing',
    liveCount: s.liveCount,
    elapsedMs: s.elapsedMs,
    flagCount: s.flagCount,
    progress: s.progress,
    error: s.error,
    start,
    stop,
    flag,
    processPending
  }
}

/** Lightweight subscription for surfaces (e.g. the Home card) that only need the recording phase. */
export function useAmbientRecordingPhase(): CapturePhase {
  return useCaptureStore(s => s.phase)
}

/** Live elapsed ms of the current recording, for a compact "recording 02:14" readout anywhere. */
export function useAmbientRecordingElapsed(): number {
  return useCaptureStore(s => s.elapsedMs)
}
