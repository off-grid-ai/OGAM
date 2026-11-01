/**
 * ttsStore — engine loading, download, voice restore, cache and persistence branches.
 *
 * Ours runs for real: the store actions, the registry's Kokoro engine and its executorch bridge
 * (mounted by EngineBridge), the residency manager, the hardware service and the persist migration.
 * Faked (harness/speechDevice): RAM at the native memory leaf, ExecuTorch's resource cache, the
 * executorch speech runtime and the audio output. State is seeded through the store's own actions,
 * or through what a previous launch saved to device storage.
 *
 * The residency invariant is asserted as observable state (isResident/getResidents), what the
 * runtime has loaded, and what the cache holds — never that a function was called.
 */
import { GB } from '../../harness/nativeBoundary';
import { launchSpeech, type SpeechApp, type SpeechLaunchOptions } from '../../harness/speechDevice';

let app: SpeechApp | undefined;

async function launch(options: SpeechLaunchOptions = {}) {
  app = await launchSpeech(options);
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The voice model was freed (as residency does under memory pressure): the engine is cold. */
async function coolEngine(a: SpeechApp) {
  await a.rtl.act(async () => { await a.store().releaseEngine(); });
  await a.rtl.waitFor(() => expect(a.store().isReady).toBe(false));
}

/** A text model resident at `sizeMB`; reports whether residency unloaded it. */
function residentTextModel(a: SpeechApp, sizeMB: number) {
  const state = { unloaded: false };
  a.residency.register({ key: 'text', type: 'text', sizeMB }, async () => { state.unloaded = true; });
  return state;
}

// ── initializeEngine (residency-gated load) ──────────────────────────────

describe('initializeEngine', () => {
  it('bails with no active engine — no residency load, no error', async () => {
    const a = await launch({ selectEngine: false });

    await a.run(() => a.store().initializeEngine());

    expect(a.residency.isResident('tts')).toBe(false);
    expect(a.runtime.loaded()).toEqual([]);
    expect(a.store().error).toBeNull();
  });

  it('speak turn: fits → the voice model is loaded AND resident at its working-set size', async () => {
    const a = await launch();
    await coolEngine(a);

    await a.run(() => a.store().initializeEngine({ speak: true }));

    await a.rtl.waitFor(() => expect(a.store().isReady).toBe(true));
    expect(a.runtime.loaded()).toEqual(['af_heart']);
    // Kokoro's executorch working set (320 MB), not its 82 MB file.
    expect(a.residency.getResidents().find(r => r.key === 'tts')?.sizeMB).toBe(320);
    expect(a.store().error).toBeNull();
  });

  it('warm/preload: NO room → skips quietly (not resident, no error, nothing loaded)', async () => {
    const a = await launch({ ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2 * GB } });
    await coolEngine(a);
    const text = residentTextModel(a, a.residency.getBudgetMB());

    await a.run(() => a.store().initializeEngine()); // override defaults to false

    expect(a.runtime.loaded()).toEqual([]);
    expect(a.residency.isResident('tts')).toBe(false);
    expect(a.residency.isResident('text')).toBe(true); // a warm never evicts
    expect(text.unloaded).toBe(false);
    expect(a.store().error).toBeNull();
  });

  it('Load Anyway (override): loads even with ~500 MB free (Load Anyway always loads)', async () => {
    const a = await launch();
    await coolEngine(a);
    a.boundary.setRam({ platform: 'android', totalBytes: 12 * GB, availBytes: 0.5 * GB });

    await a.run(() => a.store().initializeEngine({ override: true }));

    await a.rtl.waitFor(() => expect(a.store().isReady).toBe(true));
    expect(a.residency.isResident('tts')).toBe(true);
    expect(a.runtime.loaded()).toEqual(['af_heart']);
    expect(a.store().error).toBeNull();
  });

  it('the TTS resident cannot be evicted while it plays, and can when idle', async () => {
    const a = await launch();
    await coolEngine(a);
    await a.run(() => a.store().initializeEngine({ speak: true }));
    await a.rtl.waitFor(() => expect(a.store().isReady).toBe(true));

    // Playing: a text load that needs the room cannot take it.
    let speech!: Promise<void>;
    await a.rtl.act(async () => { speech = a.store().speak('a long reply', 'm1'); });
    await a.rtl.waitFor(() => expect(a.store().playbackStatus).toBe('playing'));
    await a.rtl.act(async () => {
      await a.residency.makeRoomFor({ key: 'llm', type: 'text', sizeMB: a.residency.getBudgetMB() - 100 });
    });
    expect(a.residency.isResident('tts')).toBe(true);
    expect(a.runtime.loaded()).toEqual(['af_heart']);

    // Idle: the same load evicts it.
    await a.play(1);
    await a.rtl.act(async () => { await speech; });
    await a.rtl.act(async () => {
      await a.residency.makeRoomFor({ key: 'llm', type: 'text', sizeMB: a.residency.getBudgetMB() - 100 });
    });
    expect(a.residency.isResident('tts')).toBe(false);
  });

  it('eviction releases the engine: the runtime is unloaded and the engine reads cold', async () => {
    const a = await launch();
    await coolEngine(a);
    await a.run(() => a.store().initializeEngine({ speak: true }));
    await a.rtl.waitFor(() => expect(a.residency.isResident('tts')).toBe(true));

    await a.rtl.act(async () => {
      await a.residency.runExclusive('load:llm', async () => {
        await a.residency.makeRoomFor({ key: 'llm', type: 'text', sizeMB: 1800 }, { override: true });
      });
    });

    expect(a.residency.isResident('tts')).toBe(false);
    await a.rtl.waitFor(() => expect(a.runtime.loaded()).toEqual([]));
    expect(a.store().isReady).toBe(false);
  });
});

// ── stopStreaming delegation ─────────────────────────────────────────────

describe('stopStreaming', () => {
  it('is a safe no-op from idle', async () => {
    const a = await launch();
    expect(() => a.store().stopStreaming()).not.toThrow();
    expect(a.store().playbackStatus).toBe('idle');
  });
});

// ── setEngine: restore a saved voice ─────────────────────────────────────

describe('setEngine saved-voice restore', () => {
  it('re-applies, after a relaunch, the voice the person picked', async () => {
    const first = await launch();
    await first.rtl.act(async () => { first.store().setVoice('am_michael').catch(() => {}); });
    await first.rtl.waitFor(() => expect(first.store().activeVoiceId).toBe('am_michael'), { timeout: 8000 });
    const files = first.cache.files;
    await first.close();

    const next = await launch({ preserveStorage: true, files, download: false });

    expect(next.engine()?.getActiveVoice()?.id).toBe('am_michael');
    expect(next.store().activeVoiceId).toBe('am_michael');
  });

  it('does NOT re-apply a saved voice the engine does not offer (the engine keeps its default)', async () => {
    const storage = require('@react-native-async-storage/async-storage');
    await storage.setItem('tts-store', JSON.stringify({
      state: { settings: { engineId: 'kokoro', voiceByEngine: { kokoro: 'ghost-voice' } } },
      version: 0,
    }));

    const a = await launch({ preserveStorage: true, download: false });

    expect(a.engine()?.getActiveVoice()?.id).toBe('af_heart');
    // The store still reports the saved id (its `savedVoice ?? …` projection).
    expect(a.store().activeVoiceId).toBe('ghost-voice');
  });
});

// ── checkDownloadStatus backfill ─────────────────────────────────────────

describe('checkDownloadStatus flag backfill', () => {
  it('backfills modelDownloaded when the completed files are found on the device', async () => {
    const a = await launch({ download: false });
    expect(a.store().settings.modelDownloaded?.kokoro).toBe(false);

    a.cache.seedVoice(); // an earlier install completed these transfers
    await a.rtl.act(async () => { await a.store().checkDownloadStatus(); });

    expect(a.store().settings.modelDownloaded?.kokoro).toBe(true);
  });

  it('does NOT backfill when the files are not on the device', async () => {
    const a = await launch({ download: false });

    await a.rtl.act(async () => { await a.store().checkDownloadStatus(); });

    expect(a.store().settings.modelDownloaded?.kokoro).toBe(false);
  });
});

// ── downloadModels ───────────────────────────────────────────────────────

describe('downloadModels', () => {
  it('persists the downloaded flags after a successful download, with the files in the cache', async () => {
    const a = await launch({ download: false });

    await a.rtl.act(async () => { await a.store().downloadModels(); });

    expect(a.store().settings.modelDownloaded?.kokoro).toBe(true);
    expect(a.store().settings.voiceAssetsDownloaded?.kokoro).toEqual(['af_heart']);
    expect([...a.cache.files].some(path => path.endsWith('af_heart.bin'))).toBe(true);
    expect(a.store().error).toBeNull();
  });

  it('surfaces an error and persists nothing when the download fails', async () => {
    const a = await launch({ download: false });
    a.cache.failFetch(new Error('network down'));

    await a.rtl.act(async () => { await a.store().downloadModels(); });

    expect(a.store().error).toBe('network down');
    expect(a.store().settings.modelDownloaded?.kokoro).toBe(false);
  });

  it('a second tap while a download is in flight changes nothing', async () => {
    const a = await launch({ download: false });
    const finish = a.cache.holdNext(0.4);
    let first!: Promise<void>;
    await a.rtl.act(async () => { first = a.store().downloadModels(); });
    await a.rtl.waitFor(() => expect(a.store().isDownloading).toBe(true));
    await a.rtl.waitFor(() => expect(a.store().overallDownloadProgress).toBe(0.4));

    await a.rtl.act(async () => { await a.store().downloadModels(); });

    // Returned at once: the first transfer is still in flight, untouched.
    expect(a.store().isDownloading).toBe(true);
    expect(a.store().overallDownloadProgress).toBe(0.4);
    expect(a.cache.files.size).toBe(0);

    await a.rtl.act(async () => { finish(); await first; });
    expect(a.store().settings.modelDownloaded?.kokoro).toBe(true);
  });
});

// ── deleteModels ─────────────────────────────────────────────────────────

describe('deleteModels', () => {
  it('clears the downloaded flag and the files, zeroes progress, and drops an in-flight voice switch', async () => {
    const a = await launch();
    a.cache.holdNext(0.2); // the new voice's files are still transferring
    await a.rtl.act(async () => { a.store().setVoice('am_michael').catch(() => {}); });
    await a.rtl.waitFor(() => expect(a.store().isSwitchingVoice).toBe(true));

    await a.rtl.act(async () => { await a.store().deleteModels(); });

    expect(a.store().settings.modelDownloaded?.kokoro).toBe(false);
    expect(a.store().overallDownloadProgress).toBe(0);
    expect(a.store().isSwitchingVoice).toBe(false);
    expect([...a.cache.files].some(path => path.endsWith('synthesizer.pte'))).toBe(false);
    // The voice the person used until the switch is gone too, not just the one being switched to.
    expect([...a.cache.files].filter(path => path.endsWith('.bin'))).toEqual([]);
  });

  it('removes every voice the person downloaded, not just the active one', async () => {
    const a = await launch();
    await a.run(() => a.store().setVoice('am_michael'));
    const voices = () => [...a.cache.files].filter(path => path.endsWith('.bin'));
    expect(voices().some(path => path.endsWith('af_heart.bin'))).toBe(true);
    expect(voices().some(path => path.endsWith('am_michael.bin'))).toBe(true);

    await a.rtl.act(async () => { await a.store().deleteModels(); });

    expect(voices()).toEqual([]);
    expect(a.store().settings.modelDownloaded?.kokoro).toBe(false);
  });
});

// ── releaseEngine ──────────────────────────────────────────────────────────

describe('releaseEngine', () => {
  it('releases the active engine: the runtime is unloaded', async () => {
    const a = await launch();
    expect(a.runtime.loaded()).toEqual(['af_heart']);

    await a.rtl.act(async () => { await a.store().releaseEngine(); });

    await a.rtl.waitFor(() => expect(a.runtime.loaded()).toEqual([]));
    expect(a.store().isReady).toBe(false);
  });

  it('is a no-op when there is no active engine', async () => {
    const a = await launch({ selectEngine: false });
    await expect(a.store().releaseEngine()).resolves.toBeUndefined();
  });
});

// ── generateAndSave capability guard ─────────────────────────────────────

describe('generateAndSave capability guard', () => {
  it('rejects for Kokoro, which streams and cannot save audio', async () => {
    const a = await launch();
    await expect(a.store().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(/does not support audio generation/i);
    expect(a.runtime.spoken).toEqual([]);
  });

  it('rejects when there is no active engine', async () => {
    const a = await launch({ selectEngine: false });
    await expect(a.store().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(/no active tts engine/i);
  });
});

// ── refreshCacheSize / clearAudioCache (OuteTTS-only) ────────────────────

describe('cache actions only apply to an engine with an audio cache', () => {
  it('refreshCacheSize reports no audio cache for Kokoro', async () => {
    const a = await launch();
    await a.rtl.act(async () => { await a.store().refreshCacheSize(); });
    expect(a.store().audioCacheSizeMB).toBe(0);
  });

  it('clearAudioCache is a safe no-op for Kokoro', async () => {
    const a = await launch();
    await a.rtl.act(async () => { await a.store().clearAudioCache(); });
    expect(a.store().audioCacheSizeMB).toBe(0);
    expect(a.store().error).toBeNull();
  });
});

// ── Persisted settings migration ────────────────────────────────────────────
// What an older build saved is read back by a fresh launch; the migration runs on that read.

describe('ttsStore persisted settings migration', () => {
  /** Save `settings` the way an older build did, then start the app and read them back. */
  async function relaunchWith(settings: Record<string, unknown> | null) {
    const storage = require('@react-native-async-storage/async-storage');
    if (settings) await storage.setItem('tts-store', JSON.stringify({ state: { settings }, version: 0 }));
    const a = await launch({ preserveStorage: true, selectEngine: false });
    return a.store().settings as unknown as Record<string, unknown>;
  }

  it('starts from the defaults when nothing was saved', async () => {
    const storage = require('@react-native-async-storage/async-storage');
    await storage.removeItem('tts-store');
    const s = await relaunchWith(null);
    expect(s.engineId).toBe('kokoro');
    expect(s.voiceByEngine).toEqual({});
  });

  it('backfills voice and download records when missing', async () => {
    const s = await relaunchWith({ engineId: 'kokoro' });
    expect(s.voiceByEngine).toEqual({});
    expect(s.modelDownloaded).toEqual({});
    expect(s.voiceAssetsDownloaded).toEqual({});
  });

  it('migrates flat kokoroVoiceId and voiceId into voiceByEngine', async () => {
    const s = await relaunchWith({ engineId: 'kokoro', kokoroVoiceId: 'af_bella', voiceId: 'legacy-oute' });
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('af_bella');
    expect((s.voiceByEngine as Record<string, string>).outetts).toBe('legacy-oute');
    expect(s.kokoroVoiceId).toBeUndefined();
    expect(s.voiceId).toBeUndefined();
  });

  it('does NOT overwrite an existing per-engine voice with the flat legacy key', async () => {
    const s = await relaunchWith({ engineId: 'kokoro', voiceByEngine: { kokoro: 'keep-me' }, kokoroVoiceId: 'af_bella' });
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('keep-me');
    expect(s.kokoroVoiceId).toBe('af_bella');
  });

  it('defaults engineId to kokoro when absent', async () => {
    const s = await relaunchWith({ voiceByEngine: {} });
    expect(s.engineId).toBe('kokoro');
  });
});
