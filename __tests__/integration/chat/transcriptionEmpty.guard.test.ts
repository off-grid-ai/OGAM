/**
 * GUARD (integration) — transcription with no result must NOT auto-send an empty turn; it tells the user
 * instead. resolveTranscription is the single seam every voice-note send should route through: an empty
 * transcript → do NOT dispatch, surface a clear message (whisper-not-ready vs no-speech distinguished).
 * Locks the correct behavior the Q20/B5b bug bypasses (Voice.ts:149-151 auto-sends content='' on the
 * direct-audio path instead of routing here).
 */
import { resolveTranscription } from '../../../src/components/ChatInput/transcriptionOutcome';

describe('transcription empty result (guard)', () => {
  it('does not dispatch and shows a "couldn\'t hear that" message when the transcript is empty', () => {
    const outcome = resolveTranscription(true, '   ');
    expect(outcome.dispatch).toBe(false);
    if (!outcome.dispatch) expect(outcome.message).toMatch(/hear that/i);
  });

  it('tells the user the voice model failed to load when whisper is not ready', () => {
    const outcome = resolveTranscription(false, '');
    expect(outcome.dispatch).toBe(false);
    if (!outcome.dispatch) expect(outcome.message).toMatch(/voice model/i);
  });

  it('dispatches the trimmed transcript when speech was heard', () => {
    expect(resolveTranscription(true, '  what is the capital of France  ')).toEqual({ dispatch: true, text: 'what is the capital of France' });
  });
});
