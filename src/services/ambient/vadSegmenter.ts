/**
 * Voice-activity segmenter for the 24/7 ambient recorder — a PURE state machine.
 *
 * The ambient recorder captures a continuous mic stream all day. Storing and transcribing 8 hours of
 * mostly-silence is worthless (battery, storage, and it buries the 6 things that mattered). So the
 * capture layer feeds this one RMS/energy level per frame, and this decides where SPEECH is: it opens
 * a segment when energy crosses a threshold and closes it after a silence gap, dropping blips too
 * short to be speech and force-splitting anything that runs too long. Only closed segments get stored
 * and (later) transcribed.
 *
 * Pure and import-free on purpose — same discipline as the desktop meeting `decide()` machine. The
 * native capture + iOS background-audio wiring lives elsewhere and only pumps frames through here, so
 * the segmentation policy is unit-testable without a microphone. One frame in → at most one closed
 * segment out (a force-split closes one and immediately re-opens the next in `state`).
 */

/** One measured moment of the mic: monotonic time and this buffer's loudness (RMS, 0..~). */
export interface EnergyFrame {
  tMs: number
  rms: number
}

/** A detected span of speech, in the same monotonic clock as the frames. */
export interface SpeechSegment {
  startMs: number
  endMs: number
}

export interface VadConfig {
  /** RMS at or above this counts as speech. Below is silence. */
  energyThreshold: number
  /** Silence this long (ms) after the last speech frame closes the open segment. */
  minSilenceMs: number
  /** Segments shorter than this (ms) are dropped as blips, not stored. */
  minSpeechMs: number
  /** A single segment is force-split once it reaches this length (ms), so a long
   *  monologue still yields transcribable chunks instead of one unbounded file. */
  maxSegmentMs: number
}

/** Defaults tuned for room speech at 16 kHz mono. Callers may override per device/mic. */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  energyThreshold: 0.015,
  minSilenceMs: 800,
  minSpeechMs: 400,
  maxSegmentMs: 30_000
}

export interface VadState {
  phase: 'silence' | 'speech'
  /** Start of the open segment (valid only while phase === 'speech'). */
  segmentStartMs: number
  /** Time of the most recent speech frame in the open segment. */
  lastSpeechMs: number
}

export function initialVadState(): VadState {
  return { phase: 'silence', segmentStartMs: 0, lastSpeechMs: 0 }
}

export interface VadStep {
  state: VadState
  /** A segment closed on this frame, or null. */
  segment: SpeechSegment | null
}

/** Advance the machine by one frame. Pure: same (state, frame, config) → same result. */
export function advanceVad(state: VadState, frame: EnergyFrame, config: VadConfig): VadStep {
  const speaking = frame.rms >= config.energyThreshold

  if (state.phase === 'silence') {
    if (!speaking) return { state, segment: null }
    // Speech begins.
    return {
      state: { phase: 'speech', segmentStartMs: frame.tMs, lastSpeechMs: frame.tMs },
      segment: null
    }
  }

  // phase === 'speech'
  if (speaking) {
    const advanced: VadState = { ...state, lastSpeechMs: frame.tMs }
    // Force-split a segment that has run too long, re-opening a new one at this frame.
    if (frame.tMs - state.segmentStartMs >= config.maxSegmentMs) {
      return {
        state: { phase: 'speech', segmentStartMs: frame.tMs, lastSpeechMs: frame.tMs },
        segment: { startMs: state.segmentStartMs, endMs: frame.tMs }
      }
    }
    return { state: advanced, segment: null }
  }

  // Silent frame while in a segment: close it once the silence gap is long enough.
  if (frame.tMs - state.lastSpeechMs < config.minSilenceMs) {
    return { state, segment: null }
  }
  const closed = closeSegment(state, config)
  return { state: initialVadState(), segment: closed }
}

/** Close any open segment at end-of-stream (e.g. recording stopped). */
export function flushVad(state: VadState, config: VadConfig): VadStep {
  if (state.phase === 'silence') return { state, segment: null }
  return { state: initialVadState(), segment: closeSegment(state, config) }
}

/** The closed span [start, lastSpeech], or null if it was too short to be speech. */
function closeSegment(state: VadState, config: VadConfig): SpeechSegment | null {
  if (state.lastSpeechMs - state.segmentStartMs < config.minSpeechMs) return null
  return { startMs: state.segmentStartMs, endMs: state.lastSpeechMs }
}
