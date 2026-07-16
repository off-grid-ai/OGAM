/**
 * Streaming-speech coordinator — turns streaming assistant text into spoken
 * audio sentence-by-sentence. Verifies the gating (voice mode + engine ready),
 * thinking is never spoken, the queue drains through the engine, the trailing
 * partial is flushed on finish, and reset aborts.
 */
import logger from '@offgrid/core/utils/logger';

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockEngine = { speak: jest.fn().mockResolvedValue(undefined), getActiveVoice: jest.fn(() => null), getPhase: jest.fn(() => 'ready'), release: jest.fn().mockResolvedValue(undefined), displayName: 'Mock' };
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: jest.fn(() => mockEngine) },
}));

jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(), setState: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import {
  feedStreamingText, finishStreamingText, resetStreamingSpeech, isStreamingSpeechActive,
  stopStreamingSpeechForTurn, _setSpeakTimeoutForTest,
} from '../../../pro/audio/streamingSpeech';

const store = useTTSStore as unknown as { getState: jest.Mock; setState: jest.Mock };
const flush = () => new Promise<void>((r) => setImmediate(r));

let state: Record<string, any>;

function setMode(interfaceMode: 'chat' | 'audio', isReady: boolean) {
  state = {
    settings: { interfaceMode, enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady, playbackElapsed: 0, playSessionId: 0, currentMessageId: null, playbackStatus: 'idle',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.speak.mockResolvedValue(undefined);
  setMode('audio', true);
  store.getState.mockImplementation(() => state);
  store.setState.mockImplementation((partial: any) => {
    const p = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...p };
  });
  resetStreamingSpeech();
  (logger as any); // referenced to keep import
});

describe('feedStreamingText gating', () => {
  it('does nothing in chat mode', async () => {
    setMode('chat', true);
    feedStreamingText('Hello there.');
    await flush();
    expect(mockEngine.speak).not.toHaveBeenCalled();
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('does nothing when the engine is not ready (and not already active)', async () => {
    setMode('audio', false);
    feedStreamingText('Hello there.');
    await flush();
    expect(mockEngine.speak).not.toHaveBeenCalled();
  });
});

describe('streaming playback', () => {
  it('speaks a completed sentence through the engine', async () => {
    feedStreamingText('Hello there. And mo');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1);
    expect(mockEngine.speak.mock.calls[0][0]).toBe('Hello there.');
    expect(isStreamingSpeechActive()).toBe(true);
  });

  it('never speaks the thinking, only the answer', async () => {
    feedStreamingText('<think>internal reasoning here</think>The answer is yes.');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1);
    expect(mockEngine.speak.mock.calls[0][0]).toBe('The answer is yes.');
    expect(mockEngine.speak.mock.calls[0][0]).not.toContain('reasoning');
  });

  it('flushes the trailing partial sentence on finish', async () => {
    feedStreamingText('First done. Trailing tail with no period');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // "First done."
    finishStreamingText('First done. Trailing tail with no period', 'msg-1');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(2);
    expect(mockEngine.speak.mock.calls[1][0]).toBe('Trailing tail with no period');
  });
});

describe('lifecycle', () => {
  it('reset clears active state', async () => {
    feedStreamingText('Hello there.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    resetStreamingSpeech();
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('finish returns false when nothing was streaming', () => {
    expect(finishStreamingText('anything', 'm')).toBe(false);
  });
});

// The device bug: pausing a streaming auto-speak fed the paused engine more segments,
// which timed out and tripped the 2-failure "engine wedged → release" path, unloading
// the engine so all later playback died. "Stop" must instead abort cleanly: suppress the
// rest of the turn, project isStreaming=false, and NEVER release the engine.
describe('stopStreamingSpeechForTurn (user stop)', () => {
  it('projects isStreaming true while streaming, false after stop', async () => {
    expect(state.isStreaming).toBeFalsy();
    feedStreamingText('Speak this now.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    expect(state.isStreaming).toBe(true);
    stopStreamingSpeechForTurn();
    expect(isStreamingSpeechActive()).toBe(false);
    expect(state.isStreaming).toBe(false);
  });

  it('suppresses re-engagement for the rest of the turn (later tokens do not restart speech)', async () => {
    feedStreamingText('Hello there.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    const callsAtStop = mockEngine.speak.mock.calls.length;

    stopStreamingSpeechForTurn();
    // More tokens arrive on the SAME turn — must be ignored.
    feedStreamingText('Hello there. And even more text follows here.');
    await flush();
    await flush();
    expect(isStreamingSpeechActive()).toBe(false);
    expect(mockEngine.speak.mock.calls.length).toBe(callsAtStop); // no new speak
  });

  it('a new turn (resetStreamingSpeech) clears the suppression and speaks again', async () => {
    feedStreamingText('First turn.');
    await flush();
    stopStreamingSpeechForTurn();
    feedStreamingText('Same turn, ignored.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(false);

    resetStreamingSpeech(); // audio.stop fires this at the next turn
    feedStreamingText('Second turn speaks.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
  });

  it('stopping mid-segment does NOT advance to another segment or release the engine (no wedge)', async () => {
    _setSpeakTimeoutForTest(20); // fail fast instead of the real 15s
    // Engine can't complete (as if paused) — speak hangs, then times out.
    mockEngine.speak.mockImplementation(() => new Promise<void>(() => { /* never settles */ }));

    feedStreamingText('One. Two. Three.'); // three segments queued
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // segment 1 in flight (hung)

    stopStreamingSpeechForTurn(); // user stops mid-segment → queue cleared, session bumped

    // Let the hung speak time out; the orphaned drain must exit without a 2nd segment.
    await new Promise((r) => setTimeout(r, 40));
    await flush();

    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // never advanced to segment 2
    expect(mockEngine.release).not.toHaveBeenCalled();  // never tripped wedge → release
    expect(isStreamingSpeechActive()).toBe(false);
  });
});

// Bug OD9: in voice mode TTS spoke the model's TOOL-CALL content aloud. A
// <tool_call>…</tool_call> block contains sentence boundaries (periods, newlines),
// so the old per-sentence stripControlTokens saw only fragments (e.g. `<tool_call>{`)
// its whole-block regex could not match → the fragment was spoken. The fix strips
// COMPLETE blocks from the whole answer before segmentation and WITHHOLDS text from an
// unclosed opener until its closer arrives (mirroring how thinking is withheld).
// These assert the OBSERVABLE SPOKEN OUTPUT never contains a tool-call fragment at ANY
// streaming step — not call counts.
describe('OD9 — never speak tool-call content', () => {
  const spokenBlob = () => mockEngine.speak.mock.calls.map((c) => c[0] as string).join(' ');
  const TOOL_LEAKS = ['<tool_call', 'tool_call>', '<|tool_call', '<function_call', '<invoke', '"name"', '"args"', '"search"'];
  function expectNoToolLeak(): void {
    const blob = spokenBlob();
    for (const leak of TOOL_LEAKS) expect(blob).not.toContain(leak);
  }
  // A tool-call block spanning multiple sentence boundaries, interleaved with real answer.
  const FULL = 'Sure, let me check. <tool_call>\n{"name": "search", "args": {"q": "x. y. z"}}\n</tool_call> Here is the result.';

  it('streamed token-by-token: never speaks a tool-call fragment at ANY step', async () => {
    for (let i = 1; i <= FULL.length; i++) {
      feedStreamingText(FULL.slice(0, i)); // dynamic streaming — one more token each step
      await flush();
      expectNoToolLeak();
    }
    finishStreamingText(FULL, 'msg-od9'); // trailing flush must not leak either
    await flush();
    await flush();
    expectNoToolLeak();
    // And it DID speak the real answer — both prose sentences, nothing dropped.
    expect(spokenBlob()).toContain('Sure, let me check.');
    expect(spokenBlob()).toContain('Here is the result.');
  });

  it('withholds an UNCLOSED tool-call opener mid-stream (speaks nothing from the opener on)', async () => {
    feedStreamingText('Checking now. <tool_call>\n{"name": "search"'); // opener, no closer
    await flush();
    await flush();
    expectNoToolLeak();
    expect(spokenBlob()).toContain('Checking now.');
  });

  it('a still-FORMING opener tag (no closing > yet) is withheld', async () => {
    feedStreamingText('Okay. <tool_cal'); // bare partial opener, no boundary
    await flush();
    await flush();
    expectNoToolLeak();
    expect(spokenBlob()).toContain('Okay.');
  });

  it('a plain answer with NO tool call still streams normally (unchanged)', async () => {
    feedStreamingText('First sentence. Second sen');
    await flush();
    await flush();
    expect(mockEngine.speak).toHaveBeenCalledWith('First sentence.', expect.anything());
    finishStreamingText('First sentence. Second sentence.', 'plain-1');
    await flush();
    await flush();
    expect(spokenBlob()).toContain('Second sentence.');
    expectNoToolLeak();
  });
});
