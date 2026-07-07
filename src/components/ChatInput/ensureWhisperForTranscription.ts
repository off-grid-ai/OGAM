import type { WhisperLoadResult } from '../../stores/whisperStore';

/**
 * Decide how to get whisper resident for a voice-turn transcription — pure so it's
 * unit-testable and holds no View state. Transcription is a prerequisite of the turn
 * (whisperService.transcribeFile throws without a resident model), and the STT
 * single-model rule keeps whisper OUT of RAM while a heavier generation model is
 * resident. So:
 *
 *  1. Already loaded → done.
 *  2. No model downloaded → can't transcribe.
 *  3. Try a normal load. 'loaded' → done.
 *  4. ONLY when the load was 'blocked' by the single-model rule (a generation model
 *     owns RAM) do we free that model and retry — there's no in-flight answer to
 *     protect during transcription. A hard 'error' (corrupt/missing whisper file,
 *     native failure) means whisper won't load regardless, so we must NOT evict the
 *     user's generation model (that would strand them with nothing loaded).
 */
export interface WhisperReadinessDeps {
  isLoaded: () => boolean;
  hasDownloadedModel: () => boolean;
  loadWhisper: () => Promise<WhisperLoadResult>;
  freeGenerationModels: () => Promise<void>;
}

export async function ensureWhisperForTranscription(deps: WhisperReadinessDeps): Promise<boolean> {
  if (deps.isLoaded()) return true;
  if (!deps.hasDownloadedModel()) return false;

  const first = await deps.loadWhisper();
  if (first === 'loaded') return true;
  if (first !== 'blocked') return false; // hard failure — don't evict anything

  await deps.freeGenerationModels();
  return (await deps.loadWhisper()) === 'loaded';
}
