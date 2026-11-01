/**
 * TTS Store Unit Tests
 *
 * The engine-agnostic TTS store over the registry's real Kokoro engine and its executorch bridge
 * (mounted by EngineBridge). Faked, at the device edge only (harness/speechDevice): ExecuTorch's
 * resource cache (voice files a test can hold or fail), the executorch speech runtime (it records
 * each synthesis request and can hang like a wedged runtime), the audio output, async-storage and
 * RAM. State is reached through the store's own actions, or through what a previous launch saved.
 */
import { launchSpeech, type SpeechApp, type SpeechLaunchOptions } from '../../harness/speechDevice';

let app: SpeechApp;

async function launch(options: SpeechLaunchOptions = {}) {
  app = await launchSpeech(options);
  return app;
}

beforeEach(async () => {
  await launch();
});

afterEach(async () => {
  await app.close();
});

const getState = () => app.store();
const until = (check: () => boolean) => app.rtl.waitFor(() => expect(check()).toBe(true));

describe('ttsStore', () => {
  // ── Speak ──────────────────────────────────────────────────────────────

  describe('speak', () => {
    it('speaks the text through the engine, then clears currentMessageId when it has played', async () => {
      await app.rtl.act(async () => { void getState().speak('hello', 'msg1'); });
      await until(() => app.said().length === 1);
      expect(app.said()).toEqual(['hello']);
      expect(getState().currentMessageId).toBe('msg1');

      await app.play(2);

      await until(() => getState().currentMessageId === null);
      expect(getState().playbackStatus).toBe('idle');
    });

    it('toggles off when the same message is already speaking', async () => {
      app.runtime.reply('hang');
      await app.rtl.act(async () => { void getState().speak('hello', 'msg1'); });
      await until(() => getState().currentMessageId === 'msg1' && app.said().length === 1);

      await app.run(() => getState().speak('hello', 'msg1'));

      expect(app.said()).toEqual(['hello']);
      expect(getState().currentMessageId).toBeNull();
      expect(getState().playbackStatus).toBe('idle');
    });

    it('does nothing when TTS is disabled', async () => {
      getState().updateSettings({ enabled: false });

      await app.run(() => getState().speak('hello', 'msg1'));

      expect(app.said()).toEqual([]);
    });
  });

  // ── Stop ───────────────────────────────────────────────────────────────

  describe('stop', () => {
    it('stops a message mid-speech and clears state', async () => {
      app.runtime.reply('hang');
      await app.rtl.act(async () => { void getState().speak('a long answer', 'msg1'); });
      await until(() => getState().currentMessageId === 'msg1');
      const stopsBefore = app.runtime.stops;

      await app.rtl.act(async () => { getState().stop(); });

      expect(getState().currentMessageId).toBeNull();
      expect(getState().playbackStatus).toBe('idle');
      expect(app.runtime.stops).toBeGreaterThan(stopsBefore);
    });
  });

  describe('setVoice (logged, timeout-guarded switch)', () => {
    it('keeps the current voice active until the requested voice is ready', async () => {
      const before = getState().activeVoiceId;
      const finish = app.cache.holdNext(0.5);
      let switching!: Promise<void>;
      await app.rtl.act(async () => { switching = getState().setVoice('am_michael'); });
      await app.settle();

      expect(getState().activeVoiceId).toBe(before);
      expect(getState().pendingVoiceId).toBe('am_michael');
      expect(getState().isSwitchingVoice).toBe(true);

      finish();
      await app.run(() => switching);
      expect(getState().activeVoiceId).toBe('am_michael');
      expect(getState().settings.voiceByEngine.kokoro).toBe('am_michael');
      expect(getState().settings.voiceAssetsDownloaded?.kokoro).toContain('am_michael');
      expect(getState().pendingVoiceId).toBeNull();
      expect(getState().isSwitchingVoice).toBe(false);
    });

    it('distinguishes a first download from preparing a completed voice', async () => {
      let first!: Promise<void>;
      await app.rtl.act(async () => { first = getState().setVoice('am_michael'); });
      expect(getState().voiceSwitchNeedsDownload).toBe(true);
      await app.run(() => first);
      await app.run(() => getState().setVoice('af_heart'));

      let again!: Promise<void>;
      await app.rtl.act(async () => { again = getState().setVoice('am_michael'); });
      expect(getState().voiceSwitchNeedsDownload).toBe(false);
      await app.run(() => again);
    });

    it('does NOT hang when the voice fetch never settles: times out and recovers', async () => {
      const { _setVoiceSwitchTimeoutForTest } = require('@offgrid/pro/audio/ttsStore');
      _setVoiceSwitchTimeoutForTest(20);
      app.cache.holdNext(0.1); // a stuck native fetch, never released

      await app.run(() => getState().setVoice('am_michael'));

      // The spinner must clear and an error surfaces: never a permanent stuck state.
      expect(getState().isSwitchingVoice).toBe(false);
      expect(getState().error).toMatch(/timed out/i);
      expect(getState().failedVoiceId).toBe('am_michael');
      expect(getState().pendingVoiceId).toBeNull();
      _setVoiceSwitchTimeoutForTest(45000);
    });

    it('recovers (clears the flag, surfaces the error) when the voice fetch fails', async () => {
      app.cache.failFetch(new Error('fetch failed'));

      await app.run(() => getState().setVoice('am_michael'));

      expect(getState().isSwitchingVoice).toBe(false);
      expect(getState().error).toBe('fetch failed');
      expect(getState().failedVoiceId).toBe('am_michael');
    });

    it('deleteModels clears a stuck isSwitchingVoice (delete mid-switch must not lock the picker)', async () => {
      app.cache.holdNext(0.1); // the switch never finishes on its own
      await app.rtl.act(async () => { void getState().setVoice('am_michael'); });
      await until(() => getState().isSwitchingVoice);

      await app.run(() => getState().deleteModels());

      expect(getState().isSwitchingVoice).toBe(false);
    });
  });

  // ── Generate and Save ─────────────────────────────────────────────────

  describe('generateAndSave', () => {
    it('is refused by an engine that cannot save audio (Kokoro streams only)', async () => {
      await expect(getState().generateAndSave('hello', 'conv1', 'msg1')).rejects.toThrow('Kokoro TTS does not support audio generation.');
    });
  });

  // ── Settings ──────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('merges partial settings', () => {
      getState().updateSettings({ speed: 1.5 });
      expect(getState().settings.speed).toBe(1.5);
      expect(getState().settings.enabled).toBe(true);
    });

    it('can switch interfaceMode', () => {
      getState().updateSettings({ interfaceMode: 'audio' });
      expect(getState().settings.interfaceMode).toBe('audio');
    });
  });

  describe('clearError', () => {
    it('clears the error left by a failed voice switch', async () => {
      app.cache.failFetch(new Error('fetch failed'));
      await app.run(() => getState().setVoice('am_michael'));
      expect(getState().error).toBe('fetch failed');

      getState().clearError();

      expect(getState().error).toBeNull();
      expect(getState().failedVoiceId).toBeNull();
    });
  });

  // ── Routing & engine ────────────────────────────────────────────────────
  describe('play routing', () => {
    it('synthesizes via the engine when there is no audio file', async () => {
      await app.rtl.act(async () => { void getState().play('msg-x', { text: 'hello world' }); });
      await until(() => app.said().length === 1);
      expect(app.said()).toEqual(['hello world']);
    });
  });

  describe('seek', () => {
    it('is a no-op for a clip that was never played', async () => {
      await app.run(() => getState().seek('msg-x', 0.5));
      expect(app.said()).toEqual([]);
    });
  });

  describe('setEngine fallback', () => {
    it('falls back to the default when the requested engine is not registered', async () => {
      await app.run(() => getState().setEngine('outetts'));
      expect(getState().settings.engineId).toBe('kokoro');
    });
  });

  // The persisted modelDownloaded flag is the durable cross-restart truth (set only after a genuine
  // fetch, cleared only by an explicit delete). The engine's in-memory completeness signal is volatile:
  // after a relaunch it starts false. checkDownloadStatus must reconcile the engine TOWARD the persisted
  // truth, or a present-on-disk model reports not-downloaded and every play() bails (the on-device TTS
  // dead-play bug).
  describe('checkDownloadStatus reconciles the engine to the persisted truth', () => {
    /** Relaunch over the same storage and voice files, without downloading again. */
    async function relaunch() {
      const files = app.cache.files;
      await app.close();
      await launch({ preserveStorage: true, files, download: false });
    }

    it('after a relaunch, a model downloaded before reports downloaded', async () => {
      expect(getState().settings.modelDownloaded?.kokoro).toBe(true);
      await relaunch();

      await app.run(() => getState().checkDownloadStatus());

      expect(getState().assets.map(a => a.status)).toEqual(expect.arrayContaining(['downloaded']));
      expect(getState().assets.every(a => a.status === 'downloaded')).toBe(true);
    });

    it('does NOT fabricate downloaded when the model was deleted', async () => {
      await app.run(() => getState().deleteModels());
      expect(getState().settings.modelDownloaded?.kokoro).toBeFalsy();
      await relaunch();

      await app.run(() => getState().checkDownloadStatus());

      expect(getState().assets.length).toBeGreaterThan(0);
      expect(getState().assets.some(a => a.status === 'downloaded')).toBe(false);
    });

    it('does NOT report downloaded while a download is in flight (respects the live fetch)', async () => {
      await app.run(() => getState().deleteModels());
      const finish = app.cache.holdNext(0.4);
      let downloading!: Promise<void>;
      await app.rtl.act(async () => { downloading = getState().downloadModels(); });
      await until(() => getState().isDownloading);

      await app.run(() => getState().checkDownloadStatus());

      expect(getState().assets.some(a => a.status === 'downloaded')).toBe(false);
      finish();
      await app.run(() => downloading);
    });
  });
});
