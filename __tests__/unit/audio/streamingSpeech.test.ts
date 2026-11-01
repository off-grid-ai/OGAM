/**
 * Streaming-speech coordinator — turns streaming assistant text into spoken
 * audio sentence-by-sentence. Verifies the gating (voice mode + engine ready),
 * thinking is never spoken, the queue drains through the engine, the trailing
 * partial is flushed on finish, and reset aborts.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

type StreamingModule = typeof import('../../../pro/audio/streamingSpeech');
type TtsStoreModule = typeof import('../../../pro/audio/ttsStore');

// streamingSpeech, the TTS store, the Kokoro engine and its executorch bridge (mounted through
// EngineBridge, as the app root mounts it) and the residency manager run for real. Faked, because
// they are the phone: ExecuTorch's resource fetcher, its useTextToSpeech hook (which records each
// segment it is asked to synthesize), the disk and RAM.
let feedStreamingText: StreamingModule['feedStreamingText'];
let finishStreamingText: StreamingModule['finishStreamingText'];
let resetStreamingSpeech: StreamingModule['resetStreamingSpeech'];
let isStreamingSpeechActive: StreamingModule['isStreamingSpeechActive'];
let stopStreamingSpeechForTurn: StreamingModule['stopStreamingSpeechForTurn'];
let _setSpeakTimeoutForTest: StreamingModule['_setSpeakTimeoutForTest'];
let useTTSStore: TtsStoreModule['useTTSStore'];
let rtl: ReturnType<typeof requireRTL>;
let spoken: string[];
let synthesis: 'finishes' | 'hangs';
let unmountBridge: () => void;

const flush = () => rtl.act(async () => { await new Promise<void>(r => setTimeout(r, 10)); });
const until = (check: () => boolean) => rtl.waitFor(() => expect(check()).toBe(true));
const state = () => useTTSStore.getState();
const setMode = (interfaceMode: 'chat' | 'audio') => state().updateSettings({ interfaceMode });

beforeEach(async () => {
  installNativeBoundary({ fs: true });
  require('../../harness/kokoroResourceBoundary').installKokoroResourceBoundary().seedVoice();
  spoken = [];
  synthesis = 'finishes';
  require('react-native-executorch').useTextToSpeech = (_config: unknown, opts?: { preventLoad?: boolean }) => ({
    isReady: !opts?.preventLoad, downloadProgress: opts?.preventLoad ? 0 : 1, error: null,
    stream: ({ text }: { text: string }) => {
      spoken.push(text);
      return synthesis === 'hangs' ? new Promise<void>(() => { /* a paused engine never completes */ }) : Promise.resolve();
    },
    streamStop: () => {},
  });
  rtl = requireRTL();
  ({ useTTSStore } = require('../../../pro/audio/ttsStore') as TtsStoreModule);
  ({
    feedStreamingText, finishStreamingText, resetStreamingSpeech, isStreamingSpeechActive,
    stopStreamingSpeechForTurn, _setSpeakTimeoutForTest,
  } = require('../../../pro/audio/streamingSpeech') as StreamingModule);
  // Voice mode with Kokoro downloaded and warm.
  await state().setEngine('kokoro');
  await state().downloadModels();
  setMode('audio');
  const React = require('react');
  const { EngineBridge } = require('../../../pro/audio/ui/EngineBridge');
  ({ unmount: unmountBridge } = rtl.render(React.createElement(EngineBridge)));
  await rtl.act(async () => { await state().initializeEngine(); });
  expect(state().isReady).toBe(true);
});

afterEach(() => {
  resetStreamingSpeech();
  unmountBridge();
});

describe('feedStreamingText gating', () => {
  it('does nothing in chat mode', async () => {
    setMode('chat');
    feedStreamingText('Hello there.');
    await flush();
    expect(spoken).toEqual([]);
    expect(isStreamingSpeechActive()).toBe(false);
  });

  it('does nothing when the engine is not ready (and not already active)', async () => {
    await rtl.act(async () => { await state().releaseEngine(); });
    expect(state().isReady).toBe(false);
    feedStreamingText('Hello there.');
    await flush();
    expect(spoken).toEqual([]);
    expect(isStreamingSpeechActive()).toBe(false);
  });
});

describe('streaming playback', () => {
  it('speaks a completed sentence through the engine', async () => {
    feedStreamingText('Hello there. And mo');
    await until(() => spoken.length > 0);
    await flush();
    expect(spoken).toEqual(['Hello there.']);
    expect(isStreamingSpeechActive()).toBe(true);
  });

  it('never speaks the thinking, only the answer', async () => {
    feedStreamingText('<think>internal reasoning here</think>The answer is yes.');
    await until(() => spoken.length > 0);
    await flush();
    expect(spoken).toEqual(['The answer is yes.']);
  });

  it('flushes the trailing partial sentence on finish', async () => {
    feedStreamingText('First done. Trailing tail with no period');
    await until(() => spoken.length > 0);
    await flush();
    expect(spoken).toEqual(['First done.']);
    finishStreamingText('First done. Trailing tail with no period', 'msg-1');
    await until(() => spoken.length > 1);
    expect(spoken).toEqual(['First done.', 'Trailing tail with no period']);
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
    expect(state().isStreaming).toBeFalsy();
    feedStreamingText('Speak this now.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    expect(state().isStreaming).toBe(true);
    stopStreamingSpeechForTurn();
    expect(isStreamingSpeechActive()).toBe(false);
    expect(state().isStreaming).toBe(false);
  });

  it('suppresses re-engagement for the rest of the turn (later tokens do not restart speech)', async () => {
    feedStreamingText('Hello there.');
    await flush();
    expect(isStreamingSpeechActive()).toBe(true);
    const callsAtStop = spoken.length;

    stopStreamingSpeechForTurn();
    // More tokens arrive on the SAME turn — must be ignored.
    feedStreamingText('Hello there. And even more text follows here.');
    await flush();
    await flush();
    expect(isStreamingSpeechActive()).toBe(false);
    expect(spoken.length).toBe(callsAtStop); // no new speech
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
    // Engine can't complete (as if paused): synthesis hangs, then the speak times out.
    synthesis = 'hangs';

    feedStreamingText('One. Tw');
    await until(() => spoken.length > 0);
    expect(spoken).toEqual(['One.']); // segment 1 in flight (hung)
    feedStreamingText('One. Two. Three. Fo'); // more segments queue behind it
    await flush();

    stopStreamingSpeechForTurn(); // user stops mid-segment → queue cleared, session bumped

    // Let the hung speak time out; the orphaned drain must exit without a 2nd segment.
    await rtl.act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    await flush();

    expect(spoken).toEqual(['One.']); // never advanced to segment 2
    expect(state().isReady).toBe(true); // never tripped wedge → release
    expect(isStreamingSpeechActive()).toBe(false);
    _setSpeakTimeoutForTest(15000);
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
  const spokenBlob = () => spoken.join(' ');
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
    await until(() => spoken.length > 0);
    expect(spoken).toEqual(['First sentence.']);
    finishStreamingText('First sentence. Second sentence.', 'plain-1');
    await until(() => spoken.length > 1);
    expect(spokenBlob()).toContain('Second sentence.');
    expectNoToolLeak();
  });
});
