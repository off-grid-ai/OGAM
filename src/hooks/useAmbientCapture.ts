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
import {
  showRecordingNotification,
  hideRecordingNotification,
  onRecordingNotificationAction
} from '../services/ambient/recordingNotification'
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts'
import { whisperService } from '../services/whisperService'
import { activeMobileRoute } from '../services/modelServices/mobileLLMService'
import { macOffloadReady } from '../services/ambient/macSttExecutorFactory'
import { processOnStop } from '../services/ambient/processingModel'
import { createSpeakerAnnotator } from '../services/ambient/speakerAnnotationFactory';
import { summarizeWithDeviceLLM } from '../services/ambient/summarizerFactory'
import { selectedTextModelId } from '../services/modelServices/modelState'
import { mobileTextEngineControl } from '../services/modelServices/textEngineControl'
import { mobileResidencyIntents } from '../services/modelServices/residencyIntents'
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
let unsubscribeNotifAction: (() => void) | null = null
const LIVE_SLICE_DIR = `${RNFS.CachesDirectoryPath}/ambient-live`

// DEV: the last transcript captured this session, so the dev replay button can re-run the pipeline
// without re-recording. Resets on app restart → falls back to DEV_TEST_PARAGRAPH.
let lastCapturedTranscript = ''
// DEV: persisted pointer to the last real recording (path + its live transcript). Lives in Documents so
// it survives app rebuilds — the dev replay re-runs the FULL pipeline (transcribe + diarize + summarize)
// on that actual audio file, so diarization is exercised too.
const DEV_STATE_FILE = `${RNFS.DocumentDirectoryPath}/dev-replay.json`
const DEV_TEST_PARAGRAPH =
  'Okay, quick recap of today. I met with Naman and Sarah about the Q3 launch, and we decided ' +
  "we're pushing the release to October tenth so QA has enough time. Three things I need to do: " +
  'first, send the updated deck to Max over Slack before five PM today; second, book the team offsite ' +
  'for next Thursday and email everyone the location; and third, follow up with the design team about ' +
  "the new onboarding screens. Sarah's going to handle the budget approval, and Naman will set up the " +
  'demo environment by Friday. Also remind me to call the vendor tomorrow morning about the contract renewal.'

// whisper emits a literal "[BLANK_AUDIO]" token for silence — strip it so it never pollutes (or becomes)
// the transcript, especially the trailing-silence final decode.
function cleanTranscript(text: string): string {
  return text.replace(/\[BLANK_AUDIO\]/gi, '').replace(/\s+/g, ' ').trim()
}

function appendFinal(text: string): void {
  const clean = cleanTranscript(text)
  if (!clean) return
  finalizedTranscript = finalizedTranscript ? `${finalizedTranscript} ${clean}` : clean
  setCapture({ liveTranscript: finalizedTranscript })
}

function showPartial(text: string): void {
  const clean = cleanTranscript(text)
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
 * Can a capture be transcribed? True when: the phone transcriber is already resident; OR a local
 * transcription model is DOWNLOADED (the build pipeline loads it on demand — it need not be in RAM right
 * now, which is why this must not gate on isModelLoaded, especially after the diarizer eviction unloads
 * whisper mid-pipeline); OR Mac offload is on, permitted, and reachable.
 */
async function captureTranscriptionReady(): Promise<boolean> {
  if (mobileSpeechInputPorts.transcriber.ready()) return true
  try {
    const model = activeMobileRoute('transcription').model
    if (model && model.source !== 'remote' && (await whisperService.isModelDownloaded(model.id))) return true
  } catch {
    // fall through to the Mac check
  }
  const s = useAmbientTimelineStore.getState()
  return s.useMacForTranscription && !s.onDeviceOnly && macOffloadReady()
}

// Transcribe + summarise one capture and write it to the day store. Shared by live stop + the
// deferred (nightly) queue, so both take exactly the same path.
async function buildAndStore(
  segs: SpeechSegment[],
  recordingPath: string,
  captureStartedAtMs: number,
  anchorsMs: number[],
  /** Live transcript safety net for the whole-take fallback — see TimelineBuildDeps.fallbackTranscript. */
  fallbackTranscript?: string
): Promise<void> {
  await ensureAmbientSliceDir()
  // Voice recognition now runs INSIDE the build, between transcription and summary (its own residency
  // phase), so the summary is speaker-attributed and each conversation gets a relevance verdict. It's
  // resolved once per capture and injected; null (voice recognition off / no diarizer) = plain build.
  const annotator = createSpeakerAnnotator()
  const built = await buildTimelineSessions(
    segs,
    recordingPath,
    captureStartedAtMs,
    {
      ...createDefaultTimelineBuildDeps(
        useAmbientTimelineStore.getState().onDeviceOnly,
        useAmbientTimelineStore.getState().useMacForTranscription
      ),
      onProgress: progress => setCapture({ progress }),
      annotate: annotator?.annotate,
      ...(fallbackTranscript ? { fallbackTranscript } : {})
    },
    anchorsMs
  )
  useAmbientTimelineStore.getState().addSessions(built)
}

export async function processPending(): Promise<void> {
  const pending = useAmbientTimelineStore.getState().pendingCaptures
  if (pending.length === 0) return
  if (!(await captureTranscriptionReady())) {
    setCapture({ error: 'Download a transcription model in Models, or connect your Mac under Remote Servers, to process recordings.' })
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

/**
 * Core re-transcribe for ONE saved conversation (no phase/error UI — callers own that). Reconstructs the
 * raw speech spans (relative to capture start), re-runs the pipeline on the saved audio with the CURRENT
 * transcription model + Mac-offload, and — because the session id is derived from its spans — overwrites
 * the same conversation in place. The user's include/exclude choice is carried across the rebuild.
 * Returns false (not thrown) when the audio is gone, so a day-level loop can skip it and keep going.
 */
async function reprocessOne(sessionId: string): Promise<boolean> {
  const session = useAmbientTimelineStore.getState().sessions.find(s => s.id === sessionId)
  const startedAtMs = session?.captureStartedAtMs
  if (!session || !session.recordingPath || startedAtMs === undefined) return false
  const localPath = session.recordingPath.replace(/^file:\/\//, '')
  if (!(await RNFS.exists(localPath).catch(() => false))) return false
  const segs: SpeechSegment[] = session.segments.map(s => ({
    startMs: s.startMs - startedAtMs,
    endMs: s.endMs - startedAtMs
  }))
  const priorOverride = session.userOverride
  await buildAndStore(segs, session.recordingPath, startedAtMs, [])
  if (typeof priorOverride === 'boolean') {
    useAmbientTimelineStore.getState().setSessionInclusion(sessionId, priorOverride)
  }
  return true
}

/**
 * Re-run transcription + summary on one saved conversation, using the CURRENT transcription model and
 * Mac-offload setting — so a user can switch to a bigger/offloaded model and redo a weak transcript.
 */
export async function reprocessSession(sessionId: string): Promise<void> {
  if (currentCapturePhase() !== 'idle') return
  if (!(await captureTranscriptionReady())) {
    setCapture({ error: 'Pick a transcription model in Models, or connect your Mac, then re-transcribe.' })
    return
  }
  setCapture({ phase: 'processing', error: null, progress: { phase: 'transcribing', done: 0, total: 1 } })
  try {
    const ok = await reprocessOne(sessionId)
    if (!ok) setCapture({ error: 'The audio for this conversation has been removed, so it can’t be re-transcribed.' })
  } catch (e) {
    setCapture({ error: e instanceof Error ? e.message : 'Re-transcribe failed. Your conversation is unchanged.' })
  } finally {
    setCapture({ phase: 'idle', progress: null })
  }
}

/**
 * Re-transcribe every conversation of a day in one pass (same CURRENT model/offload), sequentially so the
 * phone holds one model at a time. Conversations whose audio has been pruned are skipped, not fatal.
 */
export async function reprocessDay(sessionIds: readonly string[]): Promise<void> {
  if (currentCapturePhase() !== 'idle' || sessionIds.length === 0) return
  if (!(await captureTranscriptionReady())) {
    setCapture({ error: 'Pick a transcription model in Models, or connect your Mac, then re-transcribe.' })
    return
  }
  setCapture({ phase: 'processing', error: null, progress: { phase: 'transcribing', done: 0, total: sessionIds.length } })
  let skipped = 0
  try {
    for (let i = 0; i < sessionIds.length; i += 1) {
      setCapture({ progress: { phase: 'transcribing', done: i, total: sessionIds.length } })
      const ok = await reprocessOne(sessionIds[i])
      if (!ok) skipped += 1
    }
    if (skipped > 0) {
      setCapture({ error: `Re-transcribed the day. ${skipped} conversation${skipped === 1 ? '' : 's'} had no saved audio and ${skipped === 1 ? 'was' : 'were'} skipped.` })
    }
  } catch (e) {
    setCapture({ error: e instanceof Error ? e.message : 'Re-transcribe failed partway. Some conversations may be unchanged.' })
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
  } else {
    // No Mac stream (pure on-device, OR Mac chosen but not reachable — e.g. unplugged to test on-device).
    // Roll on-device: liveExecutor re-decides per slice and uses the phone when the Mac is away, so live
    // text still appears instead of a stuck "Listening…". (Needs an on-device transcription model.)
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
    // Ongoing notification with a Stop control (Android) so the recording can be driven from the
    // shade and survives backgrounding. Tapping Stop stops the capture just like the in-app button.
    showRecordingNotification(0)
    unsubscribeNotifAction = onRecordingNotificationAction(() => {
      void stop()
    })
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
  unsubscribeNotifAction?.()
  unsubscribeNotifAction = null
  hideRecordingNotification()
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
    // Commit the live rolling buffer to the transcript BEFORE teardown throws it away. For a continuous
    // take (no VAD phrase closes) this is the only place the full on-device transcript is captured, and
    // it's our reliable source when the saved file re-reads as blank audio.
    await localRolling?.finalize().catch(() => undefined)
  } finally {
    recorder = null
    liveExecutor = null
    teardownStream()
  }
  // Drop zero-length VAD blips: the segmenter can emit a [0,0] segment on flush (e.g. a 20s unbroken
  // paragraph that never closed a phrase), and a single empty segment both transcribes to nothing AND
  // suppresses the whole-take fallback below (captured.length would be 1, not 0). Filter first so a take
  // with no REAL segments falls through to the whole-take path and is transcribed from the file.
  let captured = segments.filter(s => s.endMs > s.startMs)
  const capturedStartedAt = startedAt
  const capturedAnchors = anchors
  if (!result) {
    setCapture({ phase: 'idle' })
    return
  }
  if (captured.length === 0) {
    // The VAD closed no segments. That is correct for a truly silent take, but it also happens when a
    // recording starts mid-utterance (the adaptive noise floor seeds at the speech level and gates it),
    // is one unbroken phrase with no closing silence, or — common on-device — the live rolling
    // transcriber never ran, so there is no live transcript to fall back on either. Losing a take the
    // user actually recorded is the worst outcome, so process any non-trivial take as a single span: the
    // BATCH transcriber reads the audio FILE directly (it does not need the VAD segments or a live
    // transcript), and if the file is genuinely silent it simply yields no session. A sub-second blip is
    // an accidental tap — say so instead of spinning up the pipeline on nothing.
    // The native recorder sometimes reports durationSeconds=0, which would make the whole-take span [0,0]
    // and transcribe to NOTHING (empty summary → no journal, no to-dos). Fall back to the wall-clock
    // recording time so the span is the take's ACTUAL length and the batch transcriber reads the whole file.
    const recorderMs = Math.round(result.durationSeconds * 1000)
    const wallClockMs = Math.max(0, Date.now() - capturedStartedAt)
    const durationMs = Math.max(recorderMs, wallClockMs)
    const MIN_FALLBACK_MS = 1200
    if (durationMs >= MIN_FALLBACK_MS) {
      captured = [{ startMs: 0, endMs: durationMs }]
    } else {
      setCapture({ error: 'That take was too short to process.', phase: 'idle' })
      return
    }
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
  if (!(await captureTranscriptionReady())) {
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
    // The whole-take safety net needs the text the user actually SAW. In the no-VAD-segment case the
    // rolling transcriber only ever emits partials (no phrase closes → no committed final), so
    // `finalizedTranscript` is empty; the store's `liveTranscript` carries finals + the live partial.
    const liveSoFar = useCaptureStore.getState().liveTranscript || finalizedTranscript
    // DEV-only: remember this real recording so the dev "replay last transcript" tool can re-run the full
    // pipeline on it across rebuilds. Gated so release builds never write this scratch file or hold the
    // transcript in a module global — `liveSoFar` below is the real whole-take safety net, not dev-only.
    if (__DEV__ && liveSoFar.trim()) {
      lastCapturedTranscript = liveSoFar
      void RNFS.writeFile(
        DEV_STATE_FILE,
        JSON.stringify({ path: result.path, transcript: liveSoFar }),
        'utf8'
      ).catch(() => undefined)
    }
    await buildAndStore(captured, result.path, capturedStartedAt, capturedAnchors, liveSoFar)
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

/**
 * DEV ONLY — re-run processing without re-recording. When a real recording from a previous take is still
 * on disk, run the FULL pipeline on it (transcribe → diarize → summarize) so diarization is exercised;
 * the live transcript is passed as the safety-net fallback. With no saved audio (fresh install), fall
 * back to summarising a built-in test paragraph. Lets us iterate the whole pipeline on one tap.
 */
export async function devReplayLastTranscript(): Promise<void> {
  if (useCaptureStore.getState().phase !== 'idle') return

  // Load the persisted pointer to the last real recording (survives rebuilds).
  let savedPath = ''
  let savedTranscript = ''
  try {
    const raw = await RNFS.readFile(DEV_STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { path?: string; transcript?: string }
    savedPath = parsed.path ?? ''
    savedTranscript = parsed.transcript ?? ''
  } catch {
    // no saved recording yet
  }
  // No saved pointer yet (fresh install) — fall back to the most recent recording still on disk, so the
  // very first tap can replay an earlier take's audio without re-recording.
  if (!savedPath) {
    try {
      const dir = `${RNFS.DocumentDirectoryPath}/audio-input`
      const files = await RNFS.readDir(dir)
      const wavs = files
        .filter(f => f.isFile() && f.name.endsWith('.wav'))
        .sort((a, b) => Number(b.mtime ?? 0) - Number(a.mtime ?? 0))
      if (wavs[0]) savedPath = wavs[0].path
    } catch {
      // no recordings dir yet
    }
  }
  const transcript = (savedTranscript || lastCapturedTranscript || DEV_TEST_PARAGRAPH).trim()
  const hasAudio = !!savedPath && (await RNFS.exists(savedPath).catch(() => false))

  // Full pipeline on the real audio file — this is the path that exercises diarization.
  if (hasAudio) {
    setCapture({ phase: 'processing', progress: { phase: 'transcribing', done: 0, total: 1 }, error: null })
    try {
      // 16 kHz mono s16le PCM WAV → 32000 bytes/sec; derive the span from the file size (minus header).
      const stat = await RNFS.stat(savedPath)
      const durationMs = Math.max(1200, Math.round(((Number(stat.size) - 44) / 32000) * 1000))
      const startedAtMs = Date.now() - durationMs
      await buildAndStore([{ startMs: 0, endMs: durationMs }], savedPath, startedAtMs, [], transcript)
      setCapture({ phase: 'idle', progress: null })
    } catch (e) {
      setCapture({ phase: 'idle', progress: null, error: e instanceof Error ? e.message : 'Dev replay failed' })
    }
    return
  }

  // No saved audio — summarise the test paragraph only (no diarization possible without audio).
  if (!transcript) return
  const onDeviceOnly = useAmbientTimelineStore.getState().onDeviceOnly
  setCapture({ phase: 'processing', progress: { phase: 'loading-model' }, error: null })
  try {
    const id = selectedTextModelId()
    const remote = !onDeviceOnly && mobileTextEngineControl.isRemoteActive()
    if (id && !remote && !mobileTextEngineControl.isReady()) {
      await mobileResidencyIntents.ensureText(id).catch(() => undefined)
    }
    setCapture({ progress: { phase: 'summarizing', done: 0, total: 1 } })
    const { summary, status } = await summarizeWithDeviceLLM(transcript, [], onDeviceOnly)
    const now = Date.now()
    const startMs = now - 25_000
    useAmbientTimelineStore.getState().addSessions([
      {
        id: `${startMs}_s_devreplay_${now}`,
        startMs,
        endMs: now,
        speechMs: 25_000,
        summary,
        summaryStatus: status,
        flaggedSegmentIds: [],
        recordingPath: '',
        captureStartedAtMs: startMs,
        segments: [{ id: 'dev-0', startMs, endMs: now, transcript }]
      }
    ])
    setCapture({ phase: 'idle', progress: null })
  } catch (e) {
    setCapture({
      phase: 'idle',
      progress: null,
      error: e instanceof Error ? e.message : 'Dev replay failed'
    })
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
