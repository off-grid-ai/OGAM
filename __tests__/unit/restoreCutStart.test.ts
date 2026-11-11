import { getStreamingDelta, restoreCutStart } from '../../src/services/llmHelpers';

describe('a revised stream no longer loses the start of a reply', () => {
  it('shows how the start is cut: stale text already displayed shifts the slice', () => {
    // "<|ch" was shown, then the parser replaced it with the real answer.
    const shown = '<|ch';
    const next = 'Hello there, friend';
    expect(getStreamingDelta(next, shown)).toBe('o there, friend'); // "Hell" is gone from the stream
  });
  it('puts the start back from the parsed final answer', () => {
    expect(restoreCutStart('o there, friend', 'Hello there, friend')).toBe('Hello there, friend');
  });
  it('leaves a complete streamed reply alone', () => {
    expect(restoreCutStart('Hello there', 'Hello there')).toBe('Hello there');
    expect(restoreCutStart('Hello there', undefined)).toBe('Hello there');
    expect(restoreCutStart('Hello there', '')).toBe('Hello there');
  });
  it('does not replace text the parser does not end with (tool markup, rewrites)', () => {
    expect(restoreCutStart('Sure, checking.', 'Sure, checking. <|tool_call>x')).toBe('Sure, checking.');
  });
});
