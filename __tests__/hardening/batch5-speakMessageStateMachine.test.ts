/**
 * BATCH 5 (TTS & Audio) — hardening — the speak state machine (the chat "speak" entry point:
 * the TTS store's speak action → ttsPlayback.speakMessage → the active engine).
 *
 * Everything that is ours runs for real: the store, the playback machine, the registry's Kokoro
 * engine and its executorch bridge (mounted by EngineBridge), and the residency manager. Only the
 * device is faked (harness/speechDevice): the executorch speech runtime, the audio output, the
 * resource cache and RAM. Each case asserts what reached the runtime, what is sounding on the
 * output, and the store state the UI renders.
 *
 *  - taps while preparing are ignored (a stop mid-load crashed the freshly loaded executorch stream);
 *  - a new message stops the other one first (device case 17: no dual playback);
 *  - speaking with the voice model deleted settles to idle (device case 33: no crash, no spinner);
 *  - a synthesis failure surfaces the error and returns to idle.
 */
import { launchSpeech, type SpeechApp } from '../harness/speechDevice';

let app: SpeechApp;

beforeEach(async () => {
  app = await launchSpeech();
});

afterEach(async () => {
  await app.close();
});

describe('speakMessage — preparing-tap guard (stop-only-while-preparing seam)', () => {
  it('drops a tap that arrives while another message is still loading the voice model', async () => {
    // The model was freed (as residency does under memory pressure), and its next load is slow.
    await app.rtl.act(async () => { await app.store().releaseEngine(); });
    await app.rtl.waitFor(() => expect(app.store().isReady).toBe(false));
    app.runtime.holdLoad();

    let first!: Promise<void>;
    await app.rtl.act(async () => { first = app.store().speak('first message', 'm-loading'); });
    await app.rtl.waitFor(() => expect(app.store().playbackStatus).toBe('preparing'));

    const stopsBefore = app.runtime.stops;
    await app.rtl.act(async () => { await app.store().speak('hello', 'm-different'); });

    // The tap changed nothing: the loading message keeps the spinner and nothing was spoken.
    expect(app.store().playbackStatus).toBe('preparing');
    expect(app.store().currentMessageId).toBe('m-loading');
    expect(app.runtime.spoken).toEqual([]);
    expect(app.runtime.stops).toBe(stopsBefore); // the load was not interrupted

    // Once the model is loaded, only the first message is spoken.
    await app.rtl.act(async () => { app.runtime.finishLoad(); });
    await app.rtl.waitFor(() => expect(app.said()).toEqual(['first message']));
    await app.play(1);
    await app.rtl.act(async () => { await first; });
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.said()).toEqual(['first message']);
  });
});

describe('speakMessage — supersede: stop the other message before starting', () => {
  it('stops a different playing message before speaking the new one (no dual playback)', async () => {
    let old!: Promise<void>;
    await app.rtl.act(async () => { old = app.store().speak('old text', 'm-old'); });
    await app.rtl.waitFor(() => expect(app.store().playbackStatus).toBe('playing'));
    expect(app.output.sounding()).toHaveLength(1);
    const oldSource = app.output.sounding()[0];

    let next!: Promise<void>;
    await app.rtl.act(async () => { next = app.store().speak('new text', 'm-new'); });
    await app.rtl.waitFor(() => expect(app.said()).toEqual(['old text', 'new text']));

    // The old stream was stopped at the runtime and its audio cut before the new one sounded.
    expect(app.runtime.stops).toBeGreaterThanOrEqual(1);
    expect(oldSource.stopped || oldSource.context.state === 'closed').toBe(true);
    await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));
    expect(app.output.sounding()[0]).not.toBe(oldSource);
    expect(app.store().currentMessageId).toBe('m-new');

    await app.play(1);
    await app.rtl.act(async () => { await Promise.all([old, next]); });
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });
});

describe('speakMessage — engine not ready (deleted voice model)', () => {
  it('settles to idle without throwing and says nothing when the voice model was deleted', async () => {
    // device case 33: the person removed the voice model, then taps speak.
    await app.rtl.act(async () => { await app.store().deleteModels(); });
    await app.rtl.waitFor(() => expect(app.store().isReady).toBe(false));
    expect(app.runtime.loaded()).toEqual([]);

    await app.rtl.act(async () => {
      await expect(app.store().speak('hello', 'm1')).resolves.toBeUndefined();
    });

    expect(app.runtime.spoken).toEqual([]);
    expect(app.output.sounding()).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });
});

describe('speakMessage — synthesis failure', () => {
  it('surfaces the error and returns to idle when the runtime rejects the request', async () => {
    app.runtime.reply(new Error('synthesis blew up'));

    await app.rtl.act(async () => {
      await expect(app.store().speak('hello', 'm1')).resolves.toBeUndefined(); // never rethrows to the UI
    });

    expect(app.said()).toEqual(['hello']);
    expect(app.store().error).toMatch(/synthesis blew up/i);
    expect(app.store().playbackStatus).toBe('idle');
    expect(app.store().currentMessageId).toBeNull();
  });
});
