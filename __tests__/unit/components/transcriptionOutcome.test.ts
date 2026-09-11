/**
 * Unit tests for the Shared transcription outcome — the decision that guards against the
 * silent-empty-dispatch bug: a voice note whose transcription produced nothing
 * must NEVER be dispatched (an empty transcript misrouted to the text model, and
 * a failed STT load left the user stuck with no feedback).
 */
import {
  transcriptionOutcomeFrom,
  transcriptionOutcomeMessage,
  transcriptionShouldDispatch,
} from '@offgrid/application';

const outcomeFrom = (modelReady: boolean, cleanedText: string) =>
  transcriptionOutcomeFrom({ audioBytes: 1, modelReady, cleanedText });

describe('transcription outcome', () => {
  it('dispatches the trimmed transcript when there is real speech', () => {
    const outcome = outcomeFrom(true, '  draw a dog  ');
    expect(transcriptionShouldDispatch(outcome)).toBe(true);
    expect(outcome).toEqual({ kind: 'transcribed', text: 'draw a dog' });
  });

  it('does NOT dispatch an empty transcript — surfaces "didn\'t catch that" (model loaded, clip empty)', () => {
    const outcome = outcomeFrom(true, '   ');
    expect(transcriptionShouldDispatch(outcome)).toBe(false);
    expect(transcriptionOutcomeMessage(outcome)).toMatch(/didn't catch that/i);
  });

  it('does NOT dispatch when the STT model failed to load — surfaces a memory/retry message', () => {
    const outcome = outcomeFrom(false, '');
    expect(transcriptionShouldDispatch(outcome)).toBe(false);
    expect(transcriptionOutcomeMessage(outcome)).toMatch(/couldn't load/i);
    expect(transcriptionOutcomeMessage(outcome)).toMatch(/memory|free/i);
  });

  it('distinguishes load-failure from empty-clip (two different messages)', () => {
    const loadFail = outcomeFrom(false, '');
    const emptyClip = outcomeFrom(true, '');
    expect(transcriptionShouldDispatch(loadFail)).toBe(false);
    expect(transcriptionShouldDispatch(emptyClip)).toBe(false);
    expect(transcriptionOutcomeMessage(loadFail)).not.toBe(transcriptionOutcomeMessage(emptyClip));
  });

  it('treats a whitespace/newline-only transcript as empty (never dispatched)', () => {
    expect(transcriptionShouldDispatch(outcomeFrom(true, '\n\t  '))).toBe(false);
  });
});
