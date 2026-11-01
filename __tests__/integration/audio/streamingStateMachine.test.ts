/**
 * Streaming-TTS STATE MACHINE tests.
 *
 * These pin the coordinator's behaviour by asserting the [TTS-SM] event sequence it emits for each
 * scenario — the same trace we read on-device — together with what reached the speech runtime and
 * the store state. Covers: the happy path drains to idle; a transient runtime error is tolerated; a
 * HUNG runtime times out (no permanent wedge) and two failures release the engine for a fresh
 * remount; the budget-aware warm-up; a stop always reclaims the drain lock; a user stop mid-stream
 * suppresses the rest of the turn.
 *
 * Ours runs for real: the coordinator, the store, the playback machine, the Kokoro engine and its
 * bridge, the residency manager and the hardware service. Faked (harness/speechDevice): the
 * executorch speech runtime, the audio output and its clock, the resource cache and RAM.
 */
import { GB } from '../../harness/nativeBoundary';
import { launchSpeech, type SpeechApp, type SpeechLaunchOptions } from '../../harness/speechDevice';

type SmEvent = import('@offgrid/pro/audio/ttsLog').SmEvent;

let app: SpeechApp;
let events: SmEvent[] = [];
let disposeSink: () => void;

/** Event names in order — the state-machine trace under assertion. */
const names = () => events.map(e => e.event);

async function launch(options: SpeechLaunchOptions = {}) {
  app = await launchSpeech(options);
  await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
  // A sentence that makes no progress for 40 ms counts as stuck (15 s on device).
  app.streaming._setSpeakTimeoutForTest(40);
  const { _setSmSink } = require('@offgrid/pro/audio/ttsLog') as typeof import('@offgrid/pro/audio/ttsLog');
  events = [];
  disposeSink = _setSmSink(e => events.push(e));
}

afterEach(async () => {
  disposeSink?.();
  await app.close();
});

async function feed(content: string) {
  await app.rtl.act(async () => { app.streaming.feedStreamingText(content); });
  await app.settle();
}

async function finish(content: string, messageId: string) {
  await app.rtl.act(async () => { app.streaming.finishStreamingText(content, messageId); });
  await app.settle();
}

/** Real time passes (the coordinator's no-progress watchdog runs on the clock). */
async function wait(ms: number) {
  await app.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  await app.settle();
}

/** The voice model was freed (as residency does under memory pressure): the engine is cold. */
async function coolEngine() {
  await app.rtl.act(async () => { await app.store().releaseEngine(); });
  await app.rtl.waitFor(() => expect(app.store().isReady).toBe(false));
  events = [];
}

describe('streaming state machine — happy path', () => {
  it('engages, speaks every segment, and ends idle when the stream finishes', async () => {
    await launch();
    await feed('One. ');
    await feed('One. Two. ');
    await finish('One. Two. Three', 'msg-1');
    for (let i = 0; i < 6 && app.streaming.isStreamingSpeechActive(); i++) await app.play(1);

    // Ordered milestones: engage → speak each → the coordinator's completion → idle.
    expect(names()[0]).toBe('stream ENGAGE (engine warm)');
    expect(names()).toContain('finishStreaming: flush tail + hand off');
    expect(names()).toContain('stream drain DONE → ended');
    expect(names().indexOf('status → idle (ended)')).toBeGreaterThan(names().indexOf('stream drain DONE → ended'));
    expect(app.said()).toEqual(['One.', 'Two.', 'Three']);
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.store().playbackStatus).toBe('idle');
  });
});

describe('streaming state machine — engine errors never wedge', () => {
  it('tolerates a single transient runtime error and keeps draining', async () => {
    await launch();
    app.runtime.reply(new Error('std::exception'));
    await feed('Alpha. ');
    await finish('Alpha. Bravo', 'm');
    await app.play(1);

    expect(names()).toContain('stream segment FAILED');
    expect(names()).not.toContain('stream drain ABORT: engine wedged → release for fresh remount');
    expect(names()).toContain('stream drain DONE → ended'); // recovered, finished
    expect(app.said()).toEqual(['Alpha.', 'Bravo']);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
  });

  it('a HUNG runtime times out (no permanent wedge); two failures release the engine', async () => {
    await launch();
    app.runtime.reply('hang');
    // Feed incrementally so more segments queue behind the hung first one.
    await feed('One. ');
    await feed('One. Two. ');
    await feed('One. Two. Three. ');
    // Both segment watchdogs fire → 2 failures → abort + release.
    await app.rtl.waitFor(() =>
      expect(names()).toContain('stream drain ABORT: engine wedged → release for fresh remount'));
    expect(names()).toContain('stream segment FAILED');

    // Released: the runtime is unloaded and the engine reads cold.
    await app.rtl.waitFor(() => expect(app.runtime.loaded()).toEqual([]));
    expect(app.store().isReady).toBe(false);
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.said()).toEqual(['One.']); // the queued sentences never reached the wedged runtime

    // The next turn: the coordinator is reset, the first tokens warm a fresh runtime (there is room
    // beside nothing else), and once it is loaded the turn streams again.
    await app.rtl.act(async () => { app.streaming.resetStreamingSpeech(); });
    await feed('Recovered. ');
    await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
    await feed('Recovered. Again. ');
    expect(app.said()).toEqual(['One.', 'Recovered. Again.']);
  });
});

describe('streaming state machine — budget-aware warm-up (the intelligent path)', () => {
  it('warms TTS to stream alongside the LLM when residency reports budget', async () => {
    await launch();
    await coolEngine();

    await feed('Streaming this. ');

    expect(names()).toContain('stream warm: budget OK → warming TTS to stream alongside the LLM');
    // Warmed: the voice model is loaded and resident, so the next tokens stream.
    await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
    expect(app.residency.isResident('tts')).toBe(true);
    expect(app.runtime.loaded()).toEqual(['af_heart']);
  });

  it('does NOT warm (stays speak-after) when there is no budget', async () => {
    // A 4 GB phone whose text model already fills the budget.
    await launch({ ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2 * GB } });
    await coolEngine();
    app.residency.register({ key: 'text', type: 'text', sizeMB: app.residency.getBudgetMB() }, async () => {});

    await feed('No budget here. ');
    await app.settle();

    expect(names()).toContain('stream warm SKIP: no budget to run TTS alongside the LLM → speak-after');
    expect(app.store().isReady).toBe(false);
    expect(app.runtime.loaded()).toEqual([]);
    expect(app.residency.isResident('text')).toBe(true);
    expect(app.said()).toEqual([]);
  });

  it('only attempts the warm once per turn', async () => {
    await launch();
    await coolEngine();
    app.runtime.holdLoad(); // the load takes a while, so later tokens arrive before it is ready

    await feed('One. ');
    await feed('One. Two. ');
    await feed('One. Two. Three. ');

    expect(names().filter(n => n.startsWith('stream warm'))).toEqual([
      'stream warm: budget OK → warming TTS to stream alongside the LLM',
    ]);
    expect(names().filter(n => n === 'initializeEngine start')).toHaveLength(1);
    app.runtime.finishLoad();
  });
});

describe('streaming state machine — stop always reclaims the lock', () => {
  it('a stop clears a stuck drain so the next stream is not blocked', async () => {
    await launch();
    app.runtime.reply('hang');
    await feed('Stuck. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);

    await app.rtl.act(async () => { app.store().stop(); }); // the recovery path (stop / new turn)
    expect(names()).toContain('resetStreamingSpeech (hard abort)');
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);

    events = [];
    await feed('Fresh.');
    expect(names()[0]).toBe('stream ENGAGE (engine warm)');
    expect(app.said()).toEqual(['Stuck.', 'Fresh.']);
  });
});

// The device bug: pausing a streaming auto-speak fed the paused engine more segments, which timed
// out and tripped the 2-failure "engine wedged → release" path — unloading the engine so ALL later
// playback died. The stop control must abort cleanly: no wedge, no release, and the remaining
// tokens of the turn must NOT re-engage.
describe('streaming state machine — user stops mid-stream', () => {
  it('aborts cleanly without wedging/releasing the engine, and suppresses the rest of the turn', async () => {
    await launch();
    app.runtime.reply('hang'); // the runtime cannot complete — the exact device condition
    await feed('One. Two. Three. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);
    expect(app.said()).toEqual(['One. Two. Three.']);

    await app.rtl.act(async () => { app.store().stopStreaming(); }); // the person taps STOP

    // Longer than the watchdog: the orphaned drain must exit, not advance or wedge.
    await wait(80);

    expect(names()).toContain('stopStreamingSpeechForTurn (user stop — suppress rest of turn)');
    expect(names()).not.toContain('stream drain ABORT: engine wedged → release for fresh remount');
    expect(app.runtime.loaded()).toEqual(['af_heart']); // not released
    expect(app.store().isReady).toBe(true);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);

    // More tokens on the SAME turn must not restart speech.
    await feed('One. Two. Three. Four. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.said()).toEqual(['One. Two. Three.']);
  });

  it('a new turn (resetStreamingSpeech) clears the suppression and streams again', async () => {
    await launch();
    await feed('Alpha. ');
    await app.rtl.act(async () => { app.store().stopStreaming(); });
    await feed('Alpha. Beta. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(false); // still suppressed this turn

    await app.rtl.act(async () => { app.streaming.resetStreamingSpeech(); }); // audio.stop at the next turn
    await feed('Gamma. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);
    expect(app.said()).toEqual(['Alpha.', 'Gamma.']);
  });
});
