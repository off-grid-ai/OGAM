/**
 * Streaming-TTS playback FLOW integration tests.
 *
 * Unlike the per-action unit tests (which mock the seam and call one method),
 * these drive the real streaming-speech coordinator through a full, multi-step
 * sequence against a *slow* engine — so a queue of sentences actually builds up,
 * exactly like on-device. They reproduce the two faults the [TTS-SM] device trace
 * surfaced:
 *   1. "streaming works, but once the full answer is prepared it stops speaking" —
 *      a hard abort (resetStreamingSpeech, fired by the core audio.stop hook) drops
 *      the still-queued sentences of the CURRENT answer.
 *   2. the natural end of a turn must speak EVERY queued sentence + the trailing
 *      partial, through to idle — never abandon the backlog.
 */
import logger from '@offgrid/core/utils/logger';

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// A controllable "slow" engine: speak() blocks until we release it, so we can
// build a backlog mid-stream the way a real synthesizer does.
const pending: Array<() => void> = [];
const mockEngine = {
  speak: jest.fn(() => new Promise<void>((resolve) => { pending.push(resolve); })),
  getActiveVoice: jest.fn(() => null),
  getPhase: jest.fn(() => 'processing' as const),
  displayName: 'Mock',
};
/** Release the oldest in-flight speak() and let the microtask queue settle. */
async function releaseOneSpeak(): Promise<void> {
  const next = pending.shift();
  if (next) next();
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
}

jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: jest.fn(() => mockEngine) },
}));

jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: jest.fn(), setState: jest.fn() },
}));

import { useTTSStore } from '../../../pro/audio/ttsStore';
import {
  feedStreamingText, finishStreamingText, resetStreamingSpeech, isStreamingSpeechActive,
} from '../../../pro/audio/streamingSpeech';

const store = useTTSStore as unknown as { getState: jest.Mock; setState: jest.Mock };
const flush = () => new Promise<void>((r) => setImmediate(r));
let state: Record<string, any>;

const spokenSegments = () => (mockEngine.speak.mock.calls as unknown as string[][]).map((c) => c[0]);

beforeEach(async () => {
  // streamingSpeech holds module-level state (session/draining/queue). A prior test
  // can leave a drain awaiting an unresolved speak() (draining=true). Unwind it by
  // resolving everything in flight + aborting, so each test starts truly clean.
  resetStreamingSpeech();
  for (let i = 0; i < 10 && pending.length > 0; i++) { pending.shift()!(); await flush(); }
  await flush();

  jest.clearAllMocks();
  pending.length = 0;
  mockEngine.speak.mockImplementation(() => new Promise<void>((resolve) => { pending.push(resolve); }));
  state = {
    settings: { interfaceMode: 'audio', enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady: true, playbackElapsed: 0, playSessionId: 0, currentMessageId: null, playbackStatus: 'idle',
  };
  store.getState.mockImplementation(() => state);
  store.setState.mockImplementation((partial: any) => {
    const p = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...p };
  });
  (logger as any);
});

describe('streaming TTS — full answer is spoken to the end', () => {
  it('drains the entire backlog: every queued sentence + the trailing partial is spoken in order', async () => {
    // Tokens arrive (cumulative content, like real streaming) faster than the slow
    // engine speaks → a backlog of sentences builds up behind the in-flight one.
    feedStreamingText('One. ');
    await flush();
    feedStreamingText('One. Two. ');
    feedStreamingText('One. Two. Three. ');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    expect(spokenSegments()).toEqual(['One.']); // "One." in flight; Two./Three. queued

    // Generation ends with a trailing partial that has no terminal punctuation.
    finishStreamingText('One. Two. Three. And finally four', 'assistant-1');

    // Let the slow engine work through the whole backlog.
    for (let i = 0; i < 8 && (pending.length > 0 || isStreamingSpeechActive()); i++) {
      await releaseOneSpeak();
    }

    expect(spokenSegments()).toEqual(['One.', 'Two.', 'Three.', 'And finally four']);
    expect(isStreamingSpeechActive()).toBe(false);
    expect(state.playbackStatus).toBe('idle'); // settled, not stuck mid-playback
  });

  it('hands playback off to the real message id when the turn finalizes', async () => {
    feedStreamingText('Hello world. ');
    await flush();
    finishStreamingText('Hello world. Second part', 'assistant-42');
    await releaseOneSpeak();
    expect(state.currentMessageId).toBe('assistant-42');
  });
});

describe('streaming TTS — interruption semantics', () => {
  it('a NEW stream supersedes the old one cleanly (a new turn is allowed to interrupt)', async () => {
    feedStreamingText('Old one. ');
    await flush();
    await releaseOneSpeak(); // "Old one."

    // New generation begins — reset (what core does on a genuine new turn) then feed.
    resetStreamingSpeech();
    feedStreamingText('New answer here.');
    await flush();
    await releaseOneSpeak();

    expect(spokenSegments()).toEqual(['Old one.', 'New answer here.']);
    expect(isStreamingSpeechActive()).toBe(true);
  });

  it('REGRESSION: a hung speak() does not permanently wedge the coordinator', async () => {
    // The on-device fault: the Kokoro bridge died mid-stream so engine.speak()
    // never settled, the drain's await hung, draining stayed true forever, and
    // every later stream hit "drain: already draining" (no autoplay, no end-play).
    feedStreamingText('Stuck sentence. ');
    await flush();
    expect(spokenSegments()).toEqual(['Stuck sentence.']); // in flight, NEVER released (hangs)

    // The recovery path core triggers (stop / new turn / mode switch) must clear
    // the stuck drain lock, even though the prior speak never resolved.
    resetStreamingSpeech();
    expect(isStreamingSpeechActive()).toBe(false);

    // A brand-new stream must engage and actually speak — proving the lock cleared.
    feedStreamingText('Recovered and speaking.');
    await flush();
    await releaseOneSpeak();
    expect(spokenSegments()).toContain('Recovered and speaking.');
  });
});
