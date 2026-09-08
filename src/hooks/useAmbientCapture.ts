/**
 * The ambient capture state machine, shared by any surface that records.
 *
 * Owns one recording lifecycle: start the mic, collect live VAD segments, let the user flag moments,
 * and on stop run the (deferred-in-spirit) build - transcribe -> summarise -> write to the day store.
 * Pulled out of the screen so the Day view and the timeline share one capture, not two.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { triggerHaptic } from '../utils/haptics'
import { createAmbientRecorder } from '../services/ambient/ambientRecorderFactory'
import { ensureAmbientSliceDir } from '../services/ambient/phoneSttExecutorFactory'
import { createDefaultTimelineBuildDeps } from '../services/ambient/timelineBuilderFactory'
import { buildTimelineSessions, type BuildProgress } from '../services/ambient/timelineBuilder'
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts'
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

export function useAmbientCapture(): AmbientCapture {
  const recorderRef = useRef<AmbientRecorder | null>(null)
  const segmentsRef = useRef<SpeechSegment[]>([])
  const startedAtRef = useRef<number>(0)
  const anchorsRef = useRef<number[]>([])
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [liveCount, setLiveCount] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [flagCount, setFlagCount] = useState(0)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Transcribe + summarise one capture and write it to the day store. Shared by live stop + the
  // deferred (nightly) queue, so both take exactly the same path.
  const buildAndStore = useCallback(
    async (
      segments: SpeechSegment[],
      recordingPath: string,
      captureStartedAtMs: number,
      anchorsMs: number[]
    ): Promise<void> => {
      await ensureAmbientSliceDir()
      const built = await buildTimelineSessions(
        segments,
        recordingPath,
        captureStartedAtMs,
        {
          ...createDefaultTimelineBuildDeps(useAmbientTimelineStore.getState().onDeviceOnly),
          onProgress: setProgress
        },
        anchorsMs
      )
      useAmbientTimelineStore.getState().addSessions(built)
    },
    []
  )

  const processPending = useCallback(async () => {
    const pending = useAmbientTimelineStore.getState().pendingCaptures
    if (pending.length === 0) return
    if (!mobileSpeechInputPorts.transcriber.ready()) {
      setError('Set up a transcription model in Models to process recordings.')
      return
    }
    setPhase('processing')
    setProgress({ phase: 'transcribing', done: 0, total: 1 })
    try {
      for (const capture of pending) {
        await buildAndStore(
          capture.segments,
          capture.recordingPath,
          capture.captureStartedAtMs,
          capture.anchorsMs
        )
      }
      useAmbientTimelineStore.getState().clearPendingCaptures()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process the recordings.')
    } finally {
      setPhase('idle')
      setProgress(null)
    }
  }, [buildAndStore])

  useEffect(() => {
    if (phase !== 'recording') {
      return
    }
    const startedAt = startedAtRef.current
    setElapsedMs(Date.now() - startedAt)
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [phase])

  const flag = useCallback(() => {
    if (phase !== 'recording') {
      return
    }
    anchorsRef.current = [...anchorsRef.current, Date.now() - startedAtRef.current]
    setFlagCount(anchorsRef.current.length)
    triggerHaptic('impactMedium')
  }, [phase])

  const start = useCallback(async () => {
    setError(null)
    setLiveCount(0)
    setFlagCount(0)
    segmentsRef.current = []
    anchorsRef.current = []
    startedAtRef.current = Date.now()
    const recorder = createAmbientRecorder()
    recorderRef.current = recorder
    try {
      await recorder.start(segment => {
        segmentsRef.current = [...segmentsRef.current, segment]
        setLiveCount(segmentsRef.current.length)
      })
      setPhase('recording')
    } catch (e) {
      recorderRef.current = null
      setError(e instanceof Error ? e.message : 'Could not start recording.')
    }
  }, [])

  const stop = useCallback(async () => {
    let result: { path: string; durationSeconds: number } | null = null
    try {
      result = (await recorderRef.current?.stop()) ?? null
    } finally {
      recorderRef.current = null
    }
    const captured = segmentsRef.current
    const startedAt = startedAtRef.current
    if (!result || captured.length === 0) {
      setPhase('idle')
      return
    }
    // Nightly mode: queue the capture for a later pass instead of processing now.
    if (!processOnStop(useAmbientTimelineStore.getState().processingMode)) {
      useAmbientTimelineStore.getState().addPendingCapture({
        id: String(startedAt),
        segments: captured,
        recordingPath: result.path,
        captureStartedAtMs: startedAt,
        anchorsMs: anchorsRef.current
      })
      setPhase('idle')
      return
    }
    if (!mobileSpeechInputPorts.transcriber.ready()) {
      setError('Set up a transcription model in Models, then record.')
      setPhase('idle')
      return
    }
    setPhase('processing')
    setProgress({ phase: 'transcribing', done: 0, total: 1 })
    try {
      await buildAndStore(captured, result.path, startedAt, anchorsRef.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process the recording.')
    } finally {
      setPhase('idle')
      setProgress(null)
    }
  }, [buildAndStore])

  return {
    phase,
    recording: phase === 'recording',
    processing: phase === 'processing',
    liveCount,
    elapsedMs,
    flagCount,
    progress,
    error,
    start,
    stop,
    flag,
    processPending
  }
}
