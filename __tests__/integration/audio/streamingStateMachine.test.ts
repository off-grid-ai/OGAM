/**
 * Streaming-TTS STATE MACHINE tests.
 *
 * These pin the coordinator's behaviour by asserting the exact [TTS-SM] event
 * sequence it emits for each scenario — the same trace we read on-device. If a
 * change alters a transition, the sequence assertion fails in CI, so we're never
 * "surprised" on the phone. Covers: the happy path drains to idle; a transient
 * engine error is tolerated; a HUNG speak times out (no permanent wedge) and two
 * failures release the engine for a fresh remount; a hard reset always reclaims
 * the drain lock; a new stream supersedes the old.
 */
import logger from '@offgrid/core/utils/logger';

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Controllable engine: each test sets how speak() behaves (resolve / hang / throw).
type SpeakMode = 'resolve' | 'hang' | 'throw';
let speakMode: SpeakMode = 'resolve';
let enginePhase = 'ready';
const mockEngine = {
  speak: jest.fn(() => {
    if (speakMode === 'throw') return Promise.reject(new Error('std::exception'));
    if (speakMode === 'hang') return new Promise<void>(() => { /* never settles */ });
    return Promise.resolve();
  }),
  getActiveVoice: jest.fn(() => null),
  getPhase: jest.fn(() => enginePhase),
  release: jest.fn().mockResolvedValue(undefined),
  isFullyDownloaded: jest.fn(() => true),
  getRequiredAssets: jest.fn(() => [{ sizeBytes: 320 * 1024 * 1024 }]),
  capabilities: { peakRamMB: 320 },
  displayName: 'Mock',
};

jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: jest.fn(() => mockEngine) },
}));
const mockCanLoad = jest.fn((..._a: unknown[]) => false);
jest.mock('@offgrid/core/services/modelResidency', () => ({
  modelResidencyManager: { canLoadWithoutEviction: (...a: unknown[]) => mockCanLoad(...a) },
}));
jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(), setState: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import {
  feedStreamingText, finishStreamingText, resetStreamingSpeech, isStreamingSpeechActive, _setSpeakTimeoutForTest,
  stopStreamingSpeechForTurn,
} from '../../../pro/audio/streamingSpeech';
import { _setSmSink, type SmEvent } from '../../../pro/audio/ttsLog';

const store = useTTSStore as unknown as { getState: jest.Mock; setState: jest.Mock };
const flush = () => new Promise<void>((r) => setImmediate(r));
let state: Record<string, any>;
let events: SmEvent[] = [];
let disposeSink: () => void;

/** Event names in order — the state-machine trace under assertion. */
const names = () => events.map((e) => e.event);

beforeEach(async () => {
  jest.clearAllMocks();
  speakMode = 'resolve';
  enginePhase = 'ready';
  mockCanLoad.mockReturnValue(false);
  // clearAllMocks resets call history but NOT implementations — restore the
  // speakMode-driven impl so a prior test's mockImplementation can't leak in.
  mockEngine.speak.mockImplementation(() => {
    if (speakMode === 'throw') return Promise.reject(new Error('std::exception'));
    if (speakMode === 'hang') return new Promise<void>(() => { /* never settles */ });
    return Promise.resolve();
  });
  _setSpeakTimeoutForTest(40); // fast timeout so the "hung" case doesn't wait 15s
  state = {
    settings: { interfaceMode: 'audio', enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady: true, playbackElapsed: 0, playSessionId: 0, currentMessageId: null, playbackStatus: 'idle',
    initializeEngine: jest.fn().mockResolvedValue(undefined),
  };
  store.getState.mockImplementation(() => state);
  store.setState.mockImplementation((partial: any) => {
    const p = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...p };
  });
  resetStreamingSpeech();
  await flush();
  events = [];
  disposeSink = _setSmSink((e) => events.push(e));
  (logger as any);
});

afterEach(() => { disposeSink?.(); });

describe('streaming state machine — happy path', () => {
  it('engages, speaks every segment, and ends idle when the stream finishes', async () => {
    feedStreamingText('One. ');
    await flush();
    feedStreamingText('One. Two. ');
    await flush();
    finishStreamingText('One. Two. Three', 'msg-1');
    await flush();
    await flush();

    // Key ordered milestones of the state machine (engage → speak each → idle).
    // Completion is now owned by the playback machine: the coordinator logs
    // 'stream drain DONE → ended' then dispatches the `ended` event, whose single
    // transition is 'status → idle (ended)'.
    expect(names()[0]).toBe('stream ENGAGE (engine warm)');
    expect(names()).toContain('finishStreaming: flush tail + hand off');
    expect(names()).toContain('stream drain DONE → ended');
    expect(names()[names().length - 1]).toBe('status → idle (ended)');
    expect((mockEngine.speak.mock.calls as unknown as string[][]).map((c) => c[0])).toEqual(['One.', 'Two.', 'Three']);
    expect(isStreamingSpeechActive()).toBe(false);
    expect(state.playbackStatus).toBe('idle');
  });
});

describe('streaming state machine — engine errors never wedge', () => {
  it('tolerates a single transient speak error and keeps draining', async () => {
    let n = 0;
    mockEngine.speak.mockImplementation(() => (++n === 1 ? Promise.reject(new Error('std::exception')) : Promise.resolve()));
    feedStreamingText('Alpha. ');
    await flush();
    finishStreamingText('Alpha. Bravo', 'm');
    await flush();
    await flush();

    expect(names()).toContain('stream segment FAILED');
    expect(names()).not.toContain('stream drain ABORT: engine wedged → release for fresh remount');
    expect(names()).toContain('stream drain DONE → ended'); // recovered, finished
    expect(state.playbackStatus).toBe('idle');
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('a HUNG speak times out (no permanent wedge); two failures release the engine', async () => {
    speakMode = 'hang';
    // Feed incrementally so multiple segments queue behind the hung first one
    // (a one-shot feed makes a single segment → only one failure).
    feedStreamingText('One. ');
    await flush();
    feedStreamingText('One. Two. ');
    feedStreamingText('One. Two. Three. ');
    await flush();
    // Let both segment timeouts fire (40ms each) → 2 failures → abort+release.
    for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); await flush(); }

    expect(names()).toContain('stream segment FAILED');
    expect(names()).toContain('stream drain ABORT: engine wedged → release for fresh remount');
    expect(mockEngine.release).toHaveBeenCalled();
    // Lock released. A brand-new stream can engage afterwards — but only after the
    // wedged stream's state is cleared, which in the real app is what the next
    // generation turn does (resetStreamingSpeech on new-turn/stop). Without it the
    // aborted stream's stale active/ended flags block re-engagement. (This test never
    // ran in CI and had rotted to a bare one-flush assertion that skipped the reset.)
    speakMode = 'resolve';
    resetStreamingSpeech();
    await flush();
    feedStreamingText('Recovered. ');
    finishStreamingText('Recovered.', 'm2');
    await flush();
    expect((mockEngine.speak.mock.calls as unknown as string[][]).map((c) => c[0])).toContain('Recovered.');
  });
});

describe('streaming state machine — budget-aware warm-up (the intelligent path)', () => {
  it('warms TTS to stream alongside the LLM when residency reports budget', async () => {
    state.isReady = false; // engine cold at stream start
    enginePhase = 'idle';
    mockCanLoad.mockReturnValue(true); // headroom to coexist with the LLM
    feedStreamingText('Streaming this. ');
    await flush();
    expect(mockCanLoad).toHaveBeenCalledWith(expect.objectContaining({ key: 'tts' }));
    expect(state.initializeEngine).toHaveBeenCalled(); // warmed → will stream
    expect(names()).toContain('stream warm: budget OK → warming TTS to stream alongside the LLM');
  });

  it('does NOT warm (stays speak-after) when there is no budget', async () => {
    state.isReady = false;
    enginePhase = 'idle';
    mockCanLoad.mockReturnValue(false); // memory-tight
    feedStreamingText('No budget here. ');
    await flush();
    expect(state.initializeEngine).not.toHaveBeenCalled();
    expect(names()).toContain('stream warm SKIP: no budget to run TTS alongside the LLM → speak-after');
  });

  it('only attempts the warm once per turn', async () => {
    state.isReady = false;
    enginePhase = 'idle';
    mockCanLoad.mockReturnValue(true);
    feedStreamingText('One. ');
    feedStreamingText('One. Two. ');
    feedStreamingText('One. Two. Three. ');
    await flush();
    expect(state.initializeEngine).toHaveBeenCalledTimes(1);
  });
});

describe('streaming state machine — reset always reclaims the lock', () => {
  it('resetStreamingSpeech clears a stuck drain so the next stream is not blocked', async () => {
    speakMode = 'hang';
    feedStreamingText('Stuck. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);

    resetStreamingSpeech(); // the recovery path (stop / new turn)
    expect(names()).toContain('resetStreamingSpeech (hard abort)');
    expect(isStreamingSpeechActive()).toBe(false);

    speakMode = 'resolve';
    feedStreamingText('Fresh.');
    await flush();
    expect(names()).toContain('stream ENGAGE (engine warm)');
    expect((mockEngine.speak.mock.calls as unknown as string[][]).map((c) => c[0])).toContain('Fresh.');
  });
});

// The device bug: pausing a streaming auto-speak fed the paused engine more segments,
// which timed out and tripped the 2-failure "engine wedged → release" path — unloading
// the engine so ALL later playback died. "Stop" (stopStreamingSpeechForTurn) must abort
// cleanly: no wedge, no release, and remaining tokens for the turn must NOT re-engage.
describe('streaming state machine — user stops mid-stream', () => {
  it('aborts cleanly without wedging/releasing the engine, and suppresses the rest of the turn', async () => {
    speakMode = 'hang'; // engine can't complete (as if paused) — the exact device condition
    feedStreamingText('One. Two. Three. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // segment 1 in flight (hung)

    stopStreamingSpeechForTurn(); // user hits STOP mid-segment

    // Let the hung speak time out; the orphaned drain must exit, not advance/wedge.
    await new Promise((r) => setTimeout(r, 80));
    await flush();

    expect(names()).toContain('stopStreamingSpeechForTurn (user stop — suppress rest of turn)');
    expect(names()).not.toContain('stream drain ABORT: engine wedged → release for fresh remount');
    expect(mockEngine.release).not.toHaveBeenCalled();
    expect(mockEngine.speak).toHaveBeenCalledTimes(1); // never advanced to segment 2
    expect(isStreamingSpeechActive()).toBe(false);

    // More tokens on the SAME turn must not restart speech.
    feedStreamingText('One. Two. Three. Four. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(false);
    expect(mockEngine.speak).toHaveBeenCalledTimes(1);
  });

  it('a new turn (resetStreamingSpeech) clears the suppression and streams again', async () => {
    feedStreamingText('Alpha. ');
    await flush();
    stopStreamingSpeechForTurn();
    feedStreamingText('Alpha. Beta. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(false); // still suppressed this turn

    resetStreamingSpeech(); // audio.stop fires this at the next turn
    feedStreamingText('Gamma. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
  });
});
