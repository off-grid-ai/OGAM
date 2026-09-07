/**
 * AmbientRecorder — the 24/7 recorder's capture lifecycle owner.
 *
 * Unlike recordingController (one tap-triggered voice turn), this runs continuously: it starts the
 * mic, feeds every per-buffer RMS level through the pure VAD segmenter, and emits a segment each time
 * one closes — so downstream can persist + (deferred) transcribe only real speech. On stop it flushes
 * any open segment and returns the recording file the segment boundaries index into.
 *
 * Native-free on purpose: the concrete recorder (audioRecorderService) and the clock are injected, so
 * the whole orchestration is unit-testable without a microphone. The real wiring lives in
 * ./ambientRecorderFactory. Segmentation policy lives in ./vadSegmenter; this only orchestrates.
 */

import {
  advanceVad,
  flushVad,
  initialVadState,
  DEFAULT_VAD_CONFIG,
  type SpeechSegment,
  type VadConfig,
  type VadState
} from './vadSegmenter'

/** The slice of the native recorder this controller needs. audioRecorderService satisfies it. */
export interface AmbientCaptureRecorder {
  startRecording(): Promise<void>
  stopRecording(): Promise<{ path: string; durationSeconds: number }>
  /** Subscribe to per-buffer RMS. Returns an unsubscribe. */
  onAudioLevel(listener: (rms: number) => void): () => void
}

export interface AmbientRecorderDeps {
  recorder: AmbientCaptureRecorder
  /** Monotonic clock in ms; injected so segment timestamps are deterministic under test. */
  now: () => number
  config?: VadConfig
}

export type AmbientPhase = 'idle' | 'recording'

export type AmbientSegmentSink = (segment: SpeechSegment) => void

export class AmbientRecorder {
  private phase: AmbientPhase = 'idle'
  private vad: VadState = initialVadState()
  private startedAtMs = 0
  private unsubscribe: (() => void) | null = null
  private sink: AmbientSegmentSink | null = null
  private readonly config: VadConfig

  constructor(private readonly deps: AmbientRecorderDeps) {
    this.config = deps.config ?? DEFAULT_VAD_CONFIG
  }

  phaseNow(): AmbientPhase {
    return this.phase
  }

  /** Begin continuous capture. `onSegment` fires for each closed speech segment. Idempotent. */
  async start(onSegment: AmbientSegmentSink): Promise<void> {
    if (this.phase === 'recording') return
    this.sink = onSegment
    this.vad = initialVadState()
    await this.deps.recorder.startRecording()
    this.startedAtMs = this.deps.now()
    this.phase = 'recording'
    // Subscribe AFTER start so the recorder is live; the segmenter tolerates the first frames.
    this.unsubscribe = this.deps.recorder.onAudioLevel((rms) => this.handleLevel(rms))
  }

  private handleLevel(rms: number): void {
    if (this.phase !== 'recording') return
    const tMs = this.deps.now() - this.startedAtMs
    const step = advanceVad(this.vad, { tMs, rms }, this.config)
    this.vad = step.state
    if (step.segment) this.sink?.(step.segment)
  }

  /** Stop capture, flush any open segment, and return the recording file. Idempotent → null. */
  async stop(): Promise<{ path: string; durationSeconds: number } | null> {
    if (this.phase !== 'recording') return null
    this.unsubscribe?.()
    this.unsubscribe = null
    const flushed = flushVad(this.vad, this.config)
    if (flushed.segment) this.sink?.(flushed.segment)
    this.vad = initialVadState()
    this.phase = 'idle'
    const result = await this.deps.recorder.stopRecording()
    this.sink = null
    return result
  }
}
