/**
 * ttsPlayback — the file-playback path and the pause/resume/stop/speed routing between the file
 * player and the engine.
 *
 * Ours runs for real: the ttsPlayback module (runPlayback ticker, playSavedFile, playMessage,
 * seekMessage, pause/resume/stop routing, setPlaybackSpeed), the store, the playback machine, the
 * file player, the streaming coordinator, and the registry's Kokoro engine with its executorch
 * bridge. Faked (harness/speechDevice): the audio output (each AudioContext has a clock the test
 * plays forward; saved files decode to a duration the test puts on the device), the executorch
 * speech runtime, the resource cache and RAM.
 *
 * Each case asserts the store state the audio bubble renders and what is sounding on the output.
 */
import { launchSpeech, type SpeechApp, type FakeBufferSource } from '../../harness/speechDevice';

let app: SpeechApp;

beforeEach(async () => {
  app = await launchSpeech();
  app.store().updateSettings({ speed: 1.5 });
  app.output.files.set('/rec/a.m4a', 42);
  app.output.files.set('/rec/b.m4a', 40);
});

afterEach(async () => {
  await app.close();
});

/** The file sources (decoded recordings) the output has been asked to play. */
const fileSources = () => app.output.sources.filter(s => (s.buffer?.duration ?? 0) >= 40);

/** Start a saved recording and wait until its audio is sounding. */
async function playFile(messageId: string, audioPath: string, startOffset?: number) {
  let done!: Promise<void>;
  await app.rtl.act(async () => { done = app.store().play(messageId, { text: '', audioPath, startOffset }); });
  await app.rtl.waitFor(() => expect(fileSources().filter(s => s.offset !== null && !s.stopped && !s.ended)).toHaveLength(1));
  return { done };
}

/** Start synthesized speech and wait until it is sounding. */
async function speak(text: string, messageId: string) {
  let done!: Promise<void>;
  await app.rtl.act(async () => { done = app.store().play(messageId, { text }); });
  await app.rtl.waitFor(() => expect(app.store().playbackStatus).toBe('playing'));
  return { done };
}

describe('runPlayback (via playSavedFile) — session, ticker, promotion, finally', () => {
  it('mirrors the real position/duration, goes playing once audio flows, then ends to idle', async () => {
    let done!: Promise<void>;
    await app.rtl.act(async () => { done = app.store().play('m-file', { text: '', audioPath: '/rec/a.m4a', startOffset: 0 }); });

    // Started: preparing, and the file is remembered for foreground recovery.
    expect(app.store().playbackStatus).toBe('preparing');
    expect(app.store().currentAudioPath).toBe('/rec/a.m4a');

    // The decoded duration reaches the seekbar; no audio has played yet → still preparing.
    await app.rtl.waitFor(() => expect(app.store().playbackDuration).toBe(42));
    expect(app.store().playbackStatus).toBe('preparing');

    // Audio flows (half a second of wall time at the store's 1.5× speed) → playing.
    await app.play(0.5);
    await app.rtl.waitFor(() => expect(app.store().playbackStatus).toBe('playing'));
    await app.rtl.waitFor(() => expect(app.store().playbackElapsed).toBeCloseTo(0.75));
    expect(fileSources()[0].playbackRate.value).toBe(1.5);

    // The file plays out → idle.
    await app.play(42);
    await app.rtl.act(async () => { await done; });
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });

  it('surfaces the error and returns to idle when the file cannot be decoded', async () => {
    app.output.files.set('/rec/bad.m4a', new Error('decode exploded'));

    await app.rtl.act(async () => { await app.store().play('m-file', { text: '', audioPath: '/rec/bad.m4a' }); });

    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().error).toMatch(/decode exploded/i);
    expect(app.store().currentMessageId).toBeNull();
    expect(app.output.sounding()).toEqual([]);
  });

  it('starts the file at a non-zero startOffset', async () => {
    await playFile('m-file', '/rec/a.m4a', 7);
    expect(fileSources()[0].offset).toBe(7);
    expect(app.store().playbackElapsed).toBe(7);
  });
});

describe('playMessage — path selection + toggle-off', () => {
  it('toggles OFF when the same message is already active (no new playback)', async () => {
    await playFile('m-same', '/rec/a.m4a');
    const first = fileSources()[0];

    await app.rtl.act(async () => { await app.store().play('m-same', { text: 'hi', audioPath: '/rec/a.m4a' }); });

    expect(first.stopped).toBe(true);
    expect(fileSources()).toHaveLength(1);
    expect(app.output.sounding()).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });

  it('plays a message WITH an audioPath from the file (nothing synthesized)', async () => {
    await playFile('m-file', '/rec/a.m4a');
    expect(fileSources()[0].offset).toBe(0);
    expect(app.runtime.spoken).toEqual([]);
  });

  it('synthesizes a message WITHOUT an audioPath (no file played)', async () => {
    await speak('synthesize me', 'm-synth');
    expect(app.said()).toEqual(['synthesize me']);
    expect(fileSources()).toEqual([]);
    expect(app.store().currentMessageId).toBe('m-synth');
  });
});

describe('seekMessage', () => {
  it('is a no-op when there is no audioPath (streaming clips are not seekable)', async () => {
    await app.rtl.act(async () => { await app.store().seek('m-x', 0.5, {}); });
    expect(app.output.sources).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle');
  });

  it('stops current playback then restarts the file at fraction × duration', async () => {
    await playFile('m-file', '/rec/b.m4a');
    const before = fileSources()[0];

    await app.rtl.act(async () => { app.store().seek('m-file', 0.25, { audioPath: '/rec/b.m4a', durationSec: 40 }).catch(() => {}); });

    await app.rtl.waitFor(() => expect(fileSources()).toHaveLength(2));
    expect(before.stopped).toBe(true);
    const after = fileSources()[1];
    expect(after.offset).toBe(10); // 0.25 × 40 s
    expect(after.playbackRate.value).toBe(1.5);
    expect(app.store().currentMessageId).toBe('m-file');
  });
});

describe('pause / resume routing (file player vs engine — no branch on engine type)', () => {
  /** Whether `source`'s audio moves when time passes. */
  async function advances(source: FakeBufferSource) {
    const before = source.played;
    await app.play(0.2);
    return source.played > before;
  }

  it('pause and resume act on the FILE player when it owns the session', async () => {
    await playFile('m', '/rec/a.m4a');
    const file = fileSources()[0];

    await app.rtl.act(async () => { app.store().pause(); });
    expect(app.store().playbackStatus).toBe('paused');
    expect(await advances(file)).toBe(false);

    await app.rtl.act(async () => { app.store().resume(); });
    expect(app.store().playbackStatus).toBe('playing');
    expect(await advances(file)).toBe(true);
  });

  it('pause and resume act on the ENGINE when the file player is not active', async () => {
    await speak('a long reply', 'm');
    const speech = app.output.sounding()[0];

    await app.rtl.act(async () => { app.store().pause(); });
    expect(app.store().playbackStatus).toBe('paused');
    expect(await advances(speech)).toBe(false);

    await app.rtl.act(async () => { app.store().resume(); });
    expect(app.store().playbackStatus).toBe('playing');
    expect(await advances(speech)).toBe(true);
  });
});

describe('stopPlayback — halts every path', () => {
  it('stops a streaming auto-speak: the coordinator, the engine and its audio', async () => {
    await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
    await app.rtl.act(async () => { app.streaming.feedStreamingText('Hello there. More coming'); });
    await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);

    await app.rtl.act(async () => { app.store().stop(); });

    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.output.sounding()).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });

  it('stops a playing file', async () => {
    await playFile('m', '/rec/a.m4a');

    await app.rtl.act(async () => { app.store().stop(); });

    expect(fileSources()[0].stopped).toBe(true);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });
});

describe('stopStreamingPlayback — clean stop of an active streaming auto-speak', () => {
  it('suppresses the turn, stops (not releases) the engine, and goes idle', async () => {
    await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
    await app.rtl.act(async () => { app.streaming.feedStreamingText('Hello there. '); });
    await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));

    await app.rtl.act(async () => { app.store().stopStreaming(); });

    expect(app.output.sounding()).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle');
    // The engine stays loaded, so the finished message is replayable at once.
    expect(app.store().isReady).toBe(true);
    expect(app.runtime.loaded()).toEqual(['af_heart']);
    // The rest of this turn's tokens do not restart speech.
    await app.rtl.act(async () => { app.streaming.feedStreamingText('Hello there. And more. '); });
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.said()).toEqual(['Hello there.']);
  });
});

describe('setPlaybackSpeed — applied live to whatever is playing', () => {
  it('changes the speed of the synthesized speech playing now', async () => {
    await speak('a long reply', 'm');
    await app.rtl.act(async () => { app.store().updateSettings({ speed: 2 }); });
    expect(app.output.sounding()[0].playbackRate.value).toBe(2);
  });

  it('changes the speed of the file playing now', async () => {
    await playFile('m', '/rec/a.m4a');
    await app.rtl.act(async () => { app.store().updateSettings({ speed: 2 }); });
    expect(fileSources()[0].playbackRate.value).toBe(2);
  });
});

describe('with no engine chosen yet', () => {
  it('stopStreaming and a speed change are safe and leave playback idle', async () => {
    await app.close();
    app = await launchSpeech({ selectEngine: false });
    expect(app.engine()).toBeNull();

    expect(() => app.store().stopStreaming()).not.toThrow();
    expect(() => app.store().updateSettings({ speed: 2 })).not.toThrow();
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().settings.speed).toBe(2);
  });
});
