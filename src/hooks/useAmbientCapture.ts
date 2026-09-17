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
import RNFS from 'react-native-fs'
import { triggerHaptic } from '../utils/haptics'
import { createAmbientRecorder } from '../services/ambient/ambientRecorderFactory'
import { ensureAmbientSliceDir } from '../services/ambient/phoneSttExecutorFactory'
import { createDefaultTimelineBuildDeps } from '../services/ambient/timelineBuilderFactory'
import { buildTimelineSessions, type BuildProgress } from '../services/ambient/timelineBuilder'
import { createDefaultCaptureSttExecutor } from '../services/ambient/captureSttExecutorFactory'
import { writeSegmentWav } from '../services/ambient/livePcmWav'
import {
  createMacStreamingSttClient,
  type StreamingSttClient
} from '../services/ambient/macStreamingStt'
import {
  createLocalRollingTranscriber,
  type LocalRollingTranscriber
} from '../services/ambient/localRollingStt'
import { audioRecorderService } from '../services/audioRecorderService'
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts'
import { macOffloadReady } from '../services/ambient/macSttExecutorFactory'
import { processOnStop } from '../services/ambient/processingModel'
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore'
import type { AmbientRecorder, SegmentAudioSink } from '../services/ambient/ambientRecorder'
import type { SttExecutor } from '../services/ambient/sttExecutor'
import type { SpeechSegment } from '../services/ambient/vadSegmenter'

export type CapturePhase = 'idle' | 'recording' | 'processing'

export interface AmbientCapture {
  phase: CapturePhase
  recording: boolean
  processing: boolean
  liveCount: number
  elapsedMs: number
  flagCount: number
  /** The transcript so far, streamed phrase-by-phrase as speech segments close during recording. */
  liveTranscript: string
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
  liveTranscript: string
  progress: BuildProgress | null
  error: string | null
}

/** Module-level reactive state - one recording for the whole app, independent of any screen. */
const useCaptureStore = create<CaptureStoreState>()(() => ({
  phase: 'idle',
  liveCount: 0,
  elapsedMs: 0,
  flagCount: 0,
  liveTranscript: '',
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

// Live transcript. Two producers feed ONE display:
//  - Mac streaming (Phase 2): word-level partials + a final per phrase, straight off the WebSocket.
//  - Per-segment (Phase 1): the fallback — transcribe each closed VAD segment on-device or via the Mac
//    batch route when the stream isn't up.
// `finalizedTranscript` is the settled text; a live partial is shown appended to it but not committed
// until it finalizes, so the display never double-counts a phrase.
let liveExecutor: SttExecutor | null = null
let liveSeq = 0
let finalizedTranscript = ''
let streamClient: StreamingSttClient | null = null
let localRolling: LocalRollingTranscriber | null = null
let unsubscribeStreamFrames: (() => void) | null = null
const LIVE_SLICE_DIR = `${RNFS.CachesDirectoryPath}/ambient-live`

function appendFinal(text: string): void {
  const clean = text.trim()
  if (!clean) return
  finalizedTranscript = finalizedTranscript ? `${finalizedTranscript} ${clean}` : clean
  setCapture({ liveTranscript: finalizedTranscript })
}

function showPartial(text: string): void {
  const clean = text.trim()
  const combined = clean ? (finalizedTranscript ? `${finalizedTranscript} ${clean}` : clean) : finalizedTranscript
  setCapture({ liveTranscript: combined })
}

/** Transcribe one just-closed segment's audio and append it to the streaming transcript. Skipped when
 *  the Mac stream is live (it owns the transcript then). Best-effort: a failed live slice never touches
 *  the recording — the accurate transcript still comes from the batch pipeline at stop. */
const handleSegmentAudio: SegmentAudioSink = (segment, pcm, sampleRate) => {
  // A live transcriber (Mac WS stream, or the on-device rolling window) already owns the transcript.
  if (streamClient?.isReady() || localRolling) return
  const executor = liveExecutor
  if (!executor) return
  const durationMs = segment.endMs - segment.startMs
  const seq = (liveSeq += 1)
  void (async () => {
    const path = `${LIVE_SLICE_DIR}/live-${startedAt}-${seq}.wav`
    try {
      await RNFS.mkdir(LIVE_SLICE_DIR).catch(() => undefined)
      await writeSegmentWav(pcm, sampleRate, path)
      const { text } = await executor.transcribe({
        segmentId: `live-${seq}`,
        recordingPath: path,
        startMs: 0,
        endMs: durationMs
      })
      appendFinal(text)
    } catch {
      // Live transcription is a preview; drop this slice silently.
    } finally {
      await RNFS.unlink(path).catch(() => undefined)
    }
  })()
}

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

export async function processPending(): Promise<void> {
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
  setCapture({ error: null, liveCount: 0, flagCount: 0, elapsedMs: 0, liveTranscript: '' })
  segments = []
  anchors = []
  finalizedTranscript = ''
  startedAt = Date.now()
  // One live executor for the whole recording; it re-decides phone vs Mac per segment, same rule the
  // batch build uses. Offload is on when the user chose Mac transcription and didn't force on-device.
  const s = useAmbientTimelineStore.getState()
  const offloadToMac = s.useMacForTranscription && !s.onDeviceOnly
  liveExecutor = createDefaultCaptureSttExecutor({ offloadToMac })
  // Live transcript source, in order of preference:
  //  - Mac offload reachable → stream PCM to the Mac WebSocket for word-level partials (per-segment
  //    Mac batch is the automatic fallback if the socket never opens).
  //  - pure on-device → re-decode the growing utterance on-device every ~1.5s so words appear live
  //    rather than only when a VAD phrase closes (which, on a short take, is only at stop).
  if (offloadToMac && macOffloadReady()) {
    streamClient = createMacStreamingSttClient({
      sampleRate: 16000,
      onPartial: showPartial,
      onFinal: appendFinal
    })
  } else if (!offloadToMac) {
    localRolling = createLocalRollingTranscriber({
      executor: liveExecutor,
      onPartial: showPartial,
      onFinal: appendFinal
    })
  }
  if (streamClient || localRolling) {
    unsubscribeStreamFrames = audioRecorderService.onAudioFrames((pcm, rate) => {
      streamClient?.pushFrame(pcm)
      localRolling?.pushFrame(pcm, rate)
    })
  }
  const rec = createAmbientRecorder()
  recorder = rec
  try {
    await rec.start(segment => {
      segments = [...segments, segment]
      setCapture({ liveCount: segments.length })
      // A closed phrase — settle whichever live transcriber is running into a `final`.
      streamClient?.flush()
      localRolling?.flush()
    }, handleSegmentAudio)
    setCapture({ phase: 'recording' })
    startElapsedTimer()
  } catch (e) {
    recorder = null
    liveExecutor = null
    teardownStream()
    setCapture({ error: e instanceof Error ? e.message : 'Could not start recording.' })
  }
}

function teardownStream(): void {
  unsubscribeStreamFrames?.()
  unsubscribeStreamFrames = null
  streamClient?.stop()
  streamClient = null
  localRolling?.stop()
  localRolling = null
}

/** Save a capture to the durable pending queue - it survives restarts and drains when a transcriber
 *  is next available (Mac back in range, or a local model). The safety net for offload gaps. */
function enqueuePending(
  segs: SpeechSegment[],
  recordingPath: string,
  captureStartedAtMs: number,
  anchorsMs: number[]
): void {
  useAmbientTimelineStore.getState().addPendingCapture({
    id: String(captureStartedAtMs),
    segments: segs,
    recordingPath,
    captureStartedAtMs,
    anchorsMs
  })
}

async function stop(): Promise<void> {
  stopElapsedTimer()
  let result: { path: string; durationSeconds: number } | null = null
  try {
    result = (await recorder?.stop()) ?? null
  } finally {
    recorder = null
    liveExecutor = null
    teardownStream()
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
    // No transcriber right now (Mac out of range, no local model). Don't lose it - queue + retry later.
    enqueuePending(captured, result.path, capturedStartedAt, capturedAnchors)
    setCapture({
      error: 'Saved — will transcribe when your Mac is back in range or a local model is set up.',
      phase: 'idle'
    })
    return
  }
  setCapture({ phase: 'processing', progress: { phase: 'transcribing', done: 0, total: 1 } })
  try {
    await buildAndStore(captured, result.path, capturedStartedAt, capturedAnchors)
    setCapture({ phase: 'idle', progress: null })
  } catch (e) {
    // Transcription failed mid-build (e.g. the Mac dropped). Requeue durably rather than lose it.
    enqueuePending(captured, result.path, capturedStartedAt, capturedAnchors)
    setCapture({
      error: e instanceof Error ? e.message : 'Transcription failed — saved to retry when ready.',
      phase: 'idle',
      progress: null
    })
  }
}

/** The current capture phase, read non-reactively (for effects that must not drain mid-recording). */
export function currentCapturePhase(): CapturePhase {
  return useCaptureStore.getState().phase
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
    liveTranscript: s.liveTranscript,
    progress: s.progress,
    error: s.error,
    start,
    stop,
    flag,
    processPending
  }
}

/** Live streaming transcript of the current recording, for the recorder UI. */
export function useAmbientLiveTranscript(): string {
  return useCaptureStore(s => s.liveTranscript)
}

/** Lightweight subscription for surfaces (e.g. the Home card) that only need the recording phase. */
export function useAmbientRecordingPhase(): CapturePhase {
  return useCaptureStore(s => s.phase)
}

/** Live elapsed ms of the current recording, for a compact "recording 02:14" readout anywhere. */
export function useAmbientRecordingElapsed(): number {
  return useCaptureStore(s => s.elapsedMs)
}
