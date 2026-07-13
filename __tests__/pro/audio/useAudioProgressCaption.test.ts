import { renderHook, act } from '@testing-library/react-native';
import {
  useAudioProgressCaption,
  captionFor,
  AUDIO_PHASE,
  type ProgressSignals,
} from '@offgrid/pro/audio/ui/AudioMessageBubble/useAudioProgressCaption';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';

/**
 * useAudioProgressCaption is pure-derived UI logic over (a) its `signals` prop
 * and (b) two narrow fields of the REAL global TTS store (currentMessageId,
 * playbackStatus). There is no native runtime, network, clock, or storage in
 * the hook itself, so nothing is mocked: we drive the REAL zustand store via
 * setState and the REAL hook via renderHook, and assert the observable output
 * (the returned caption string / the monotonic high-water behavior).
 *
 * Deleting the hook body (or inverting any of its branches — the monotonic
 * clamp, the cross-message gate, the playback-wins rule, the active gate)
 * must fail these tests: every case asserts the caption OUTCOME.
 */

// The store persists a slice; snapshot & restore only the two fields the hook
// reads so this file cannot leak state onto the ttsStore suite (no pollution).
const setTTS = (currentMessageId: string | null, playbackStatus: string) =>
  act(() => {
    useTTSStore.setState({
      currentMessageId,
      // playbackStatus is a PlaybackStatus union; cast at the boundary.
      playbackStatus: playbackStatus as never,
    });
  });

let saved: { currentMessageId: string | null; playbackStatus: unknown };

beforeEach(() => {
  const s = useTTSStore.getState();
  saved = { currentMessageId: s.currentMessageId, playbackStatus: s.playbackStatus };
  // Neutral baseline: TTS does not target any bubble.
  setTTS(null, 'idle');
});

afterEach(() => {
  // Restore exactly what we found so sibling suites are untouched.
  act(() => {
    useTTSStore.setState({
      currentMessageId: saved.currentMessageId,
      playbackStatus: saved.playbackStatus as never,
    });
  });
});

const base = (over: Partial<ProgressSignals> = {}): ProgressSignals => ({
  active: true,
  messageId: 'm1',
  hasReasoning: false,
  hasAnswer: false,
  ...over,
});

describe('captionFor (pure)', () => {
  it('WAITING is model-name aware and falls back without a name', () => {
    expect(captionFor(AUDIO_PHASE.WAITING, 'Qwen')).toBe('Waiting for Qwen');
    expect(captionFor(AUDIO_PHASE.WAITING)).toBe('Waiting for response');
    expect(captionFor(AUDIO_PHASE.WAITING, '')).toBe('Waiting for response');
  });

  it('THINKING and ANSWERING are fixed strings; PLAYING (and unknown) are silent', () => {
    expect(captionFor(AUDIO_PHASE.THINKING)).toBe('Thinking…');
    expect(captionFor(AUDIO_PHASE.ANSWERING)).toBe('Streaming voice response');
    expect(captionFor(AUDIO_PHASE.PLAYING)).toBe('');
    expect(captionFor(999)).toBe('');
  });
});

describe('useAudioProgressCaption — active gate', () => {
  it('returns "" when the bubble is not active regardless of signals', () => {
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ active: false, hasReasoning: true, hasAnswer: true }),
    });
    expect(result.current).toBe('');
  });
});

describe('useAudioProgressCaption — phase derivation', () => {
  it('WAITING when active with no reasoning/answer and TTS not targeting this bubble', () => {
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ modelName: 'Gemma' }),
    });
    expect(result.current).toBe('Waiting for Gemma');
  });

  it('THINKING when reasoning present but no answer yet', () => {
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ hasReasoning: true }),
    });
    expect(result.current).toBe('Thinking…');
  });

  it('ANSWERING when answer text has started streaming', () => {
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ hasReasoning: true, hasAnswer: true }),
    });
    expect(result.current).toBe('Streaming voice response');
  });
});

describe('useAudioProgressCaption — cross-message gate', () => {
  it('ignores TTS "preparing" when it targets a DIFFERENT message id (stays WAITING)', () => {
    setTTS('other-msg', 'preparing');
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base(),
    });
    // preparing is for another bubble, so this one has not advanced past WAITING.
    expect(result.current).toBe('Waiting for response');
  });

  it('honors TTS "preparing" (ANSWERING) only when it targets THIS message id', () => {
    setTTS('m1', 'preparing');
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base(),
    });
    expect(result.current).toBe('Streaming voice response');
  });

  it('ignores TTS "playing" for a DIFFERENT id (does not clear this caption)', () => {
    setTTS('other-msg', 'playing');
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ hasReasoning: true }),
    });
    expect(result.current).toBe('Thinking…');
  });
});

describe('useAudioProgressCaption — playback wins', () => {
  it('clears the caption ("") once THIS message is playing', () => {
    setTTS('m1', 'playing');
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ hasReasoning: true, hasAnswer: true }),
    });
    expect(result.current).toBe('');
  });

  it('clears the caption ("") when THIS message is paused (still playback phase)', () => {
    setTTS('m1', 'paused');
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base({ hasAnswer: true }),
    });
    expect(result.current).toBe('');
  });
});

describe('useAudioProgressCaption — monotonic clamp', () => {
  it('advances WAITING → THINKING → ANSWERING and never regresses within one id', () => {
    const { result, rerender } = renderHook(
      (p: ProgressSignals) => useAudioProgressCaption(p),
      { initialProps: base({ modelName: 'X' }) },
    );
    expect(result.current).toBe('Waiting for X');

    act(() => rerender(base({ modelName: 'X', hasReasoning: true })));
    expect(result.current).toBe('Thinking…');

    act(() => rerender(base({ modelName: 'X', hasReasoning: true, hasAnswer: true })));
    expect(result.current).toBe('Streaming voice response');

    // Signal regresses to reasoning-only; monotonic clamp holds ANSWERING.
    act(() => rerender(base({ modelName: 'X', hasReasoning: true, hasAnswer: false })));
    expect(result.current).toBe('Streaming voice response');

    // Signal regresses all the way to nothing; still clamped at ANSWERING.
    act(() => rerender(base({ modelName: 'X' })));
    expect(result.current).toBe('Streaming voice response');
  });

  it('resets the high-water mark when the bubble is reused for a NEW message id', () => {
    const { result, rerender } = renderHook(
      (p: ProgressSignals) => useAudioProgressCaption(p),
      { initialProps: base({ hasAnswer: true }) },
    );
    expect(result.current).toBe('Streaming voice response');

    // New id, no answer yet — the clamp for the old id must NOT carry over.
    act(() => rerender(base({ messageId: 'm2', hasAnswer: false, modelName: 'Y' })));
    expect(result.current).toBe('Waiting for Y');
  });

  it('resets the high-water mark to WAITING when the bubble goes inactive, then back active', () => {
    const { result, rerender } = renderHook(
      (p: ProgressSignals) => useAudioProgressCaption(p),
      { initialProps: base({ hasAnswer: true }) },
    );
    expect(result.current).toBe('Streaming voice response');

    // Inactive: caption clears AND the clamp is reset to WAITING.
    act(() => rerender(base({ active: false, hasAnswer: true })));
    expect(result.current).toBe('');

    // Active again with no answer: proves the clamp was reset (not clamped at ANSWERING).
    act(() => rerender(base({ active: true, hasAnswer: false })));
    expect(result.current).toBe('Waiting for response');
  });
});

describe('useAudioProgressCaption — reacts to live store changes', () => {
  it('follows the REAL store: WAITING → PLAYING clears when the store starts playing this id', () => {
    const { result } = renderHook((p: ProgressSignals) => useAudioProgressCaption(p), {
      initialProps: base(),
    });
    expect(result.current).toBe('Waiting for response');

    // Drive the real store; the hook's selector must re-render and clear.
    setTTS('m1', 'playing');
    expect(result.current).toBe('');
  });
});
