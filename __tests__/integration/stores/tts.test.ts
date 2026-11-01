/**
 * TTS integration tests — the TTS store wired to the registry's real Kokoro engine.
 *
 * Ours runs for real: the store, the playback machine, the registry, the Kokoro engine and its
 * executorch bridge (mounted by EngineBridge), the residency manager and the hardware service.
 * Faked (harness/speechDevice): the executorch speech runtime, the audio output and its clock,
 * the resource cache and RAM. Each case asserts what is resident, what reached the runtime, what is
 * sounding, and the store state.
 */
import { GB } from '../../harness/nativeBoundary';
import { launchSpeech, type SpeechApp } from '../../harness/speechDevice';

let app: SpeechApp;

beforeEach(async () => {
  app = await launchSpeech();
});

afterEach(async () => {
  await app.close();
});

/** The voice model was freed (as residency does under memory pressure): the engine is cold. */
async function coolEngine() {
  await app.rtl.act(async () => { await app.store().releaseEngine(); });
  await app.rtl.waitFor(() => expect(app.store().isReady).toBe(false));
}

/** The text model the person chats with, resident at `sizeMB`. Returns whether it was unloaded. */
function residentTextModel(sizeMB: number) {
  const state = { unloaded: false };
  app.residency.register({ key: 'text', type: 'text', sizeMB }, async () => { state.unloaded = true; });
  return state;
}

describe('TTS integration', () => {
  // ── Voice sequencing ──────────────────────────────────────────────────
  // The voice model is a sidecar: it co-resides with the text model when the budget has room for both,
  // on a warm load and on a speak turn alike; a speak turn without room is refused, a warm load skips.
  describe('voice sequencing: the voice model rides beside the text model', () => {
    it('a warm/preload initializeEngine() co-resides with the text model when it fits', async () => {
      await coolEngine();
      const text = residentTextModel(1000);

      await app.run(() => app.store().initializeEngine());

      await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
      expect(app.residency.isResident('tts')).toBe(true);
      expect(app.residency.isResident('text')).toBe(true);
      expect(text.unloaded).toBe(false);
    });

    // TTS is a sidecar by design: a voice reply keeps the chat's text model loaded for the next turn,
    // so even a speak turn rides beside it rather than evicting it.
    it('a speak turn loads the voice model beside the resident text model', async () => {
      await coolEngine();
      const text = residentTextModel(1000);

      await app.run(() => app.store().initializeEngine({ speak: true }));

      await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
      expect(app.residency.isResident('tts')).toBe(true);
      expect(app.residency.isResident('text')).toBe(true);
      expect(text.unloaded).toBe(false);
    });

    // The budget counts the voice model's memory: when it does not fit beside the text model, the speak
    // turn is refused with a memory error (the Load Anyway card), never squeezed in past the budget.
    it('a speak turn that does not fit beside the text model is refused, and nothing is loaded or evicted', async () => {
      await app.close();
      app = await launchSpeech({ ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2 * GB } });
      await coolEngine();
      // Room is left, but less than the voice model's working set.
      const text = residentTextModel(app.residency.getBudgetMB() - 100);

      await expect(app.run(() => app.store().initializeEngine({ speak: true }))).rejects.toThrow(
        'Not enough free memory to load the voice model',
      );

      expect(app.store().isReady).toBe(false);
      expect(app.store().error).toBe('Not enough free memory to load the voice model');
      expect(app.runtime.loaded()).toEqual([]);
      expect(app.residency.isResident('tts')).toBe(false);
      expect(app.residency.isResident('text')).toBe(true);
      expect(text.unloaded).toBe(false);

      // Load Anyway: the person sets the budget aside, and the voice model loads.
      await app.run(() => app.store().initializeEngine({ override: true }));
      await app.rtl.waitFor(() => expect(app.store().isReady).toBe(true));
      expect(app.residency.isResident('tts')).toBe(true);
    });

    it('a warm load that does not fit skips quietly — no error, no eviction, no load', async () => {
      // A 4 GB phone whose text model already fills the budget.
      await app.close();
      app = await launchSpeech({ ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2 * GB } });
      await coolEngine();
      const text = residentTextModel(app.residency.getBudgetMB());

      await app.run(() => app.store().initializeEngine()); // warm

      // Not an error state (the speak turn will force-load later), and nothing was loaded.
      expect(app.store().error).toBeNull();
      expect(app.store().isReady).toBe(false);
      expect(app.runtime.loaded()).toEqual([]);
      expect(app.residency.isResident('tts')).toBe(false);
      expect(text.unloaded).toBe(false);
    });
  });

  // ── Chat Mode full flow ───────────────────────────────────────────────

  describe('Chat Mode: speak → stop', () => {
    it('completes the full Chat Mode flow', async () => {
      let first!: Promise<void>;
      await app.rtl.act(async () => { first = app.store().speak('hello', 'msg1'); });
      await app.rtl.waitFor(() => expect(app.store().playbackStatus).toBe('playing'));
      expect(app.store().currentMessageId).toBe('msg1');
      expect(app.runtime.spoken).toEqual([{ voice: 'af_heart', text: 'hello' }]);

      // The audio plays out → the message is done.
      await app.play(1);
      await app.rtl.act(async () => { await first; });
      expect(app.store().currentMessageId).toBeNull();
      expect(app.store().playbackStatus).toBe('idle');

      // Stop mid-speech: the runtime is told to stop and nothing is left sounding.
      await app.rtl.act(async () => { app.store().speak('second', 'msg2').catch(() => {}); });
      await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));
      const stopsBefore = app.runtime.stops;
      await app.rtl.act(async () => { app.store().stop(); });
      expect(app.runtime.stops).toBeGreaterThan(stopsBefore);
      expect(app.output.sounding()).toEqual([]);
      expect(app.store().playbackStatus).toBe('idle');
      expect(app.store().currentMessageId).toBeNull();
    });
  });

  // ── Mode switching ────────────────────────────────────────────────────

  describe('mode switching', () => {
    it('switching interfaceMode to audio takes effect', () => {
      expect(app.store().settings.interfaceMode).toBe('chat');
      app.store().updateSettings({ interfaceMode: 'audio' });
      expect(app.store().settings.interfaceMode).toBe('audio');
    });

    it('switching back to chat mode works', () => {
      app.store().updateSettings({ interfaceMode: 'audio' });
      app.store().updateSettings({ interfaceMode: 'chat' });
      expect(app.store().settings.interfaceMode).toBe('chat');
    });

    it('switching mode stops speech from the old mode', async () => {
      await app.rtl.act(async () => { app.store().speak('still talking', 'msg1').catch(() => {}); });
      await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));

      await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });

      expect(app.output.sounding()).toEqual([]);
      expect(app.store().playbackStatus).toBe('idle');
    });
  });

  // ── Engine-agnostic speak ─────────────────────────────────────────────

  describe('auto-play', () => {
    it('speak reaches the engine runtime when ready, at the chosen speed', async () => {
      app.store().updateSettings({ speed: 1.25 });
      await app.rtl.act(async () => { app.store().speak('AI response', 'last-msg').catch(() => {}); });

      await app.rtl.waitFor(() => expect(app.output.sounding()).toHaveLength(1));
      expect(app.said()).toEqual(['AI response']);
      expect(app.output.sounding()[0].playbackRate.value).toBe(1.25);
      expect(app.store().currentMessageId).toBe('last-msg');
    });
  });
});
