/**
 * VoiceRecordButton state projection — the ONE derivation of what the mic renders.
 *
 * Spec (docs/GAPS_BACKLOG.md, device-reported 2026-07-13 IMG_0143): a BACKGROUND STT
 * model download is NOT a busy state. The busy spinner is reserved for a TAP-TRIGGERED
 * model load and live transcription. While an STT model downloads:
 *   - another STT model already usable → the normal idle mic ('ready');
 *   - none usable → the unavailable-mic glyph with a small determinate download ring
 *     ('downloading'), never a full-button loader.
 *
 * Pure and zero-IO: the View computes this once and renders by kind — the download/load
 * split is owned here, not re-derived in any renderer or caller.
 */

export interface VoiceButtonInputs {
  /** Voice input is usable right now (an STT model is downloaded, or direct audio). */
  isAvailable: boolean;
  /** A tap-triggered STT model load is in flight (whisperStore.isModelLoading). */
  isModelLoading: boolean;
  /** A transcription is in flight. */
  isTranscribing: boolean;
  /** The mic is live (recording wins over the transcribing spinner). */
  isRecording: boolean;
  /** Per-model in-flight download progress (0..1); a key exists only while downloading. */
  downloadProgressById: Record<string, number>;
}

export type VoiceButtonState =
  | { kind: 'loading' }
  | { kind: 'transcribing' }
  | { kind: 'ready' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'unavailable' };

export function deriveVoiceButtonState(i: VoiceButtonInputs): VoiceButtonState {
  if (i.isModelLoading) return { kind: 'loading' };
  if (i.isTranscribing && !i.isRecording) return { kind: 'transcribing' };
  // A usable model wins over any background download — the mic stays a normal idle mic.
  if (i.isAvailable) return { kind: 'ready' };
  // No usable model: an in-flight STT download renders as download progress (the model
  // furthest along is the one about to make voice available — show its progress).
  const inFlight = Object.values(i.downloadProgressById);
  if (inFlight.length > 0) return { kind: 'downloading', progress: Math.max(...inFlight) };
  return { kind: 'unavailable' };
}

/**
 * Determinate quadrant fill for the download ring (top → right → bottom → left).
 * Static border segments — visually distinct from the rotating loading spinner.
 */
export function ringQuadrants(progress: number): [boolean, boolean, boolean, boolean] {
  return [progress > 0, progress > 0.25, progress > 0.5, progress > 0.75];
}
