/**
 * Unit tests for resolveTranscription — the decision that guards against the
 * silent-empty-dispatch bug: a voice note whose transcription produced nothing
 * must NEVER be dispatched (an empty transcript misrouted to the text model, and
 * a failed STT load left the user stuck with no feedback).
 */
import { resolveTranscription } from '../../../src/components/ChatInput/transcriptionOutcome';

describe('resolveTranscription', () => {
  it('dispatches the trimmed transcript when there is real speech', () => {
    expect(resolveTranscription(true, '  draw a dog  ')).toEqual({ dispatch: true, text: 'draw a dog' });
  });

  it('does NOT dispatch an empty transcript — surfaces "couldn\'t hear that" (model loaded, clip empty)', () => {
    const out = resolveTranscription(true, '   ');
    expect(out.dispatch).toBe(false);
    if (!out.dispatch) expect(out.message).toMatch(/couldn't hear that/i);
  });

  it('does NOT dispatch when the STT model failed to load — surfaces a memory/retry message', () => {
    const out = resolveTranscription(false, '');
    expect(out.dispatch).toBe(false);
    if (!out.dispatch) {
      expect(out.message).toMatch(/couldn't load/i);
      expect(out.message).toMatch(/memory|free/i);
    }
  });

  it('distinguishes load-failure from empty-clip (two different messages)', () => {
    const loadFail = resolveTranscription(false, '');
    const emptyClip = resolveTranscription(true, '');
    expect(loadFail.dispatch).toBe(false);
    expect(emptyClip.dispatch).toBe(false);
    if (!loadFail.dispatch && !emptyClip.dispatch) {
      expect(loadFail.message).not.toBe(emptyClip.message);
    }
  });

  it('treats a whitespace/newline-only transcript as empty (never dispatched)', () => {
    expect(resolveTranscription(true, '\n\t  ').dispatch).toBe(false);
  });
});
