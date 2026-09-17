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
  /** Subscribe to raw mono PCM frames (Float32) for live transcription. Optional — absent under test. */
  onAudioFrames?(listener: (pcm: Float32Array, sampleRate: number) => void): () => void
}

/** Delivers a closed segment's own PCM (mono Float32) for live transcription, with its timing. */
export type SegmentAudioSink = (
  segment: SpeechSegment,
  pcm: Float32Array,
  sampleRate: number
) => void

export interface AmbientRecorderDeps {
  recorder: AmbientCaptureRecorder
  /** Monotonic clock in ms; injected so segment timestamps are deterministic under test. */
  now: () => number
  config?: VadConfig
}

export type AmbientPhase = 'idle' | 'recording'

export type AmbientSegmentSink = (segment: SpeechSegment) => void

/** Keep at most this many seconds of PCM buffered for live-segment extraction (segments run shorter). */
const LIVE_PCM_BUFFER_SEC = 45

export class AmbientRecorder {
  private phase: AmbientPhase = 'idle'
  private vad: VadState = initialVadState()
  private startedAtMs = 0
  private unsubscribe: (() => void) | null = null
  private unsubscribeFrames: (() => void) | null = null
  private sink: AmbientSegmentSink | null = null
  private audioSink: SegmentAudioSink | null = null
  private readonly config: VadConfig

  // Rolling PCM buffer for live per-segment transcription. Chunks + the absolute sample index of the
  // first buffered sample, so a closed segment's [startMs,endMs] maps to a slice by the audio clock.
  private pcmChunks: Float32Array[] = []
  private pcmStartSample = 0
  private pcmTotalSamples = 0
  private sampleRate = 16000

  constructor(private readonly deps: AmbientRecorderDeps) {
    this.config = deps.config ?? DEFAULT_VAD_CONFIG
  }

  phaseNow(): AmbientPhase {
    return this.phase
  }

  /**
   * Begin continuous capture. `onSegment` fires for each closed speech segment. `onSegmentAudio`, when
   * given and the native recorder can stream PCM, also delivers that segment's audio for live
   * transcription. Idempotent.
   */
  async start(onSegment: AmbientSegmentSink, onSegmentAudio?: SegmentAudioSink): Promise<void> {
    if (this.phase === 'recording') return
    this.sink = onSegment
    this.audioSink = onSegmentAudio ?? null
    this.vad = initialVadState()
    this.resetPcm()
    await this.deps.recorder.startRecording()
    this.startedAtMs = this.deps.now()
    this.phase = 'recording'
    // Subscribe AFTER start so the recorder is live; the segmenter tolerates the first frames.
    this.unsubscribe = this.deps.recorder.onAudioLevel((rms) => this.handleLevel(rms))
    if (this.audioSink && this.deps.recorder.onAudioFrames) {
      this.unsubscribeFrames = this.deps.recorder.onAudioFrames((pcm, rate) =>
        this.handleFrames(pcm, rate)
      )
    }
  }

  private handleLevel(rms: number): void {
    if (this.phase !== 'recording') return
    const tMs = this.deps.now() - this.startedAtMs
    const step = advanceVad(this.vad, { tMs, rms }, this.config)
    this.vad = step.state
    if (step.segment) this.emitSegment(step.segment)
  }

  private handleFrames(pcm: Float32Array, sampleRate: number): void {
    if (this.phase !== 'recording' || pcm.length === 0) return
    this.sampleRate = sampleRate
    this.pcmChunks.push(pcm)
    this.pcmTotalSamples += pcm.length
    const maxSamples = LIVE_PCM_BUFFER_SEC * sampleRate
    while (this.pcmTotalSamples - this.pcmStartSample > maxSamples && this.pcmChunks.length > 1) {
      const dropped = this.pcmChunks.shift()
      if (dropped) this.pcmStartSample += dropped.length
    }
  }

  private emitSegment(segment: SpeechSegment): void {
    this.sink?.(segment)
    if (!this.audioSink) return
    const pcm = this.extractSegmentPcm(segment.startMs, segment.endMs)
    if (pcm && pcm.length > 0) this.audioSink(segment, pcm, this.sampleRate)
  }

  /** Copy the PCM for [startMs,endMs] out of the rolling buffer, or null if it fell off / is empty. */
  private extractSegmentPcm(startMs: number, endMs: number): Float32Array | null {
    const s0 = Math.max(this.pcmStartSample, Math.floor((startMs / 1000) * this.sampleRate))
    const s1 = Math.min(this.pcmTotalSamples, Math.ceil((endMs / 1000) * this.sampleRate))
    if (s1 <= s0) return null
    const out = new Float32Array(s1 - s0)
    let cursor = this.pcmStartSample
    for (const chunk of this.pcmChunks) {
      const chunkEnd = cursor + chunk.length
      const from = Math.max(s0, cursor)
      const to = Math.min(s1, chunkEnd)
      if (to > from) out.set(chunk.subarray(from - cursor, to - cursor), from - s0)
      cursor = chunkEnd
      if (cursor >= s1) break
    }
    return out
  }

  private resetPcm(): void {
    this.pcmChunks = []
    this.pcmStartSample = 0
    this.pcmTotalSamples = 0
  }

  /** Stop capture, flush any open segment, and return the recording file. Idempotent → null. */
  async stop(): Promise<{ path: string; durationSeconds: number } | null> {
    if (this.phase !== 'recording') return null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeFrames?.()
    this.unsubscribeFrames = null
    const flushed = flushVad(this.vad, this.config)
    if (flushed.segment) this.emitSegment(flushed.segment)
    this.vad = initialVadState()
    this.phase = 'idle'
    const result = await this.deps.recorder.stopRecording()
    this.sink = null
    this.audioSink = null
    this.resetPcm()
    return result
  }
}
