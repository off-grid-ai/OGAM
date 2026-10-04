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

/**
 * Adaptive-threshold config. A FIXED energy threshold either misses quiet speech in a silent room or
 * fires constantly in a loud café. Instead, track the room's own noise floor with slow-rise/fast-fall
 * (rising energy is attributed to speech, so the floor creeps up slowly; a genuine lull drops it at
 * once) and gate on floor × margin. This is the plan's "adaptive noise floor" front-gate win, and it's
 * cheap — one running number per frame. Off by default; `energyThreshold` remains the fixed fallback.
 */
export interface AdaptiveVadConfig {
  /** Speech when rms >= noiseFloor × this (and >= minFloor). ~3–4 gives clear speech-over-room. */
  marginFactor: number
  /** Max fractional RISE of the floor per second (slow — so speech can't inflate it). e.g. 1.5 = +150%/s. */
  floorRisePerSec: number
  /** Floor never drops below this absolute RMS, so true silence can't make the gate hair-trigger. */
  minFloor: number
}

export interface VadConfig {
  /** RMS at or above this counts as speech. Below is silence. Used when `adaptive` is unset. */
  energyThreshold: number
  /** Silence this long (ms) after the last speech frame closes the open segment. */
  minSilenceMs: number
  /** Segments shorter than this (ms) are dropped as blips, not stored. */
  minSpeechMs: number
  /** A single segment is force-split once it reaches this length (ms), so a long
   *  monologue still yields transcribable chunks instead of one unbounded file. */
  maxSegmentMs: number
  /** When set, the speech threshold adapts to the tracked noise floor instead of `energyThreshold`. */
  adaptive?: AdaptiveVadConfig
}

/** Defaults tuned for room speech at 16 kHz mono. Callers may override per device/mic. */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  energyThreshold: 0.015,
  minSilenceMs: 800,
  minSpeechMs: 400,
  maxSegmentMs: 30_000
}

/** Adaptive preset — same timing as the default, with a noise-floor-relative threshold. */
export const DEFAULT_ADAPTIVE_VAD_CONFIG: VadConfig = {
  ...DEFAULT_VAD_CONFIG,
  adaptive: { marginFactor: 3.5, floorRisePerSec: 1.5, minFloor: 0.005 }
}

export interface VadState {
  phase: 'silence' | 'speech'
  /** Start of the open segment (valid only while phase === 'speech'). */
  segmentStartMs: number
  /** Time of the most recent speech frame in the open segment. */
  lastSpeechMs: number
  /** Tracked noise floor (RMS) for adaptive mode. Absent until the first frame seeds it. */
  noiseFloor?: number
  /** Time of the previous frame, to size the floor's rise per elapsed second. */
  lastFrameMs?: number
}

export function initialVadState(): VadState {
  return { phase: 'silence', segmentStartMs: 0, lastSpeechMs: 0 }
}

/**
 * Effective speech threshold for a frame: the fixed `energyThreshold`, or in adaptive mode the tracked
 * floor × margin (never below `minFloor`). Pure — exported so callers/tests can inspect the live gate.
 */
export function effectiveThreshold(state: VadState, config: VadConfig): number {
  if (!config.adaptive) return config.energyThreshold
  const floor = state.noiseFloor ?? config.adaptive.minFloor
  return Math.max(config.adaptive.minFloor, floor * config.adaptive.marginFactor)
}

/**
 * Next noise floor with slow-rise / fast-fall. The floor estimates NON-speech energy, so:
 *   - it snaps DOWN to any quieter frame at once (a genuine lull re-baselines immediately), and
 *   - it only creeps UP on non-speech frames (`speaking` false) — a speech burst must never drag the
 *     floor up to itself, or the threshold would climb and swallow (drop) the very speech it should keep.
 * Undefined adaptive config → floor unused (fixed mode).
 */
function nextNoiseFloor(
  state: VadState,
  frame: EnergyFrame,
  config: VadConfig,
  speaking: boolean
): number | undefined {
  if (!config.adaptive) return undefined
  const prev = state.noiseFloor ?? frame.rms // seed at the first observed level
  if (frame.rms < prev) return frame.rms // fast fall — snap to the quieter level
  if (speaking) return prev // hold: speech energy must not inflate the noise floor
  const dtSec = state.lastFrameMs != null ? Math.max(0, (frame.tMs - state.lastFrameMs) / 1000) : 0
  const maxRise = prev * config.adaptive.floorRisePerSec * dtSec
  return Math.min(frame.rms, prev + maxRise) // slow rise on ambient only, never past the actual level
}

export interface VadStep {
  state: VadState
  /** A segment closed on this frame, or null. */
  segment: SpeechSegment | null
}

/** Advance the machine by one frame. Pure: same (state, frame, config) → same result. */
export function advanceVad(state: VadState, frame: EnergyFrame, config: VadConfig): VadStep {
  // Decide speech against the CURRENT (pre-update) floor, then advance the floor — so a loud speech
  // frame is judged against the room, not against itself.
  const speaking = frame.rms >= effectiveThreshold(state, config)
  const noiseFloor = nextNoiseFloor(state, frame, config, speaking)
  // Stamp the adaptive tracking onto whatever state the phase machine returns (incl. a reset to silence).
  const withFloor = (s: VadState): VadState =>
    config.adaptive ? { ...s, noiseFloor, lastFrameMs: frame.tMs } : s

  if (state.phase === 'silence') {
    if (!speaking) return { state: withFloor(state), segment: null }
    // Speech begins.
    return {
      state: withFloor({ phase: 'speech', segmentStartMs: frame.tMs, lastSpeechMs: frame.tMs }),
      segment: null
    }
  }

  // phase === 'speech'
  if (speaking) {
    const advanced: VadState = { ...state, lastSpeechMs: frame.tMs }
    // Force-split a segment that has run too long, re-opening a new one at this frame.
    if (frame.tMs - state.segmentStartMs >= config.maxSegmentMs) {
      return {
        state: withFloor({ phase: 'speech', segmentStartMs: frame.tMs, lastSpeechMs: frame.tMs }),
        segment: { startMs: state.segmentStartMs, endMs: frame.tMs }
      }
    }
    return { state: withFloor(advanced), segment: null }
  }

  // Silent frame while in a segment: close it once the silence gap is long enough.
  if (frame.tMs - state.lastSpeechMs < config.minSilenceMs) {
    return { state: withFloor(state), segment: null }
  }
  const closed = closeSegment(state, config)
  return { state: withFloor(initialVadState()), segment: closed }
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
