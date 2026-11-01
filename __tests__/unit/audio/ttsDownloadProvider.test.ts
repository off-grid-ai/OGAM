/**
 * TTS download provider (pro): wraps the Kokoro engine under the uniform download contract. list maps
 * downloaded / downloading / FAILED engines; capabilities reflect the executorch gaps (cancel:false,
 * determinateProgress:false) while retry IS supported (re-running the download resumes from cache);
 * remove and retry go through the TTS store.
 *
 * The provider, the TTS store, the engine registry and the Kokoro engine run for real. Only
 * ExecuTorch's resource fetcher (the device cache) is faked: harness/kokoroResourceBoundary.
 */
import type { installKokoroResourceBoundary as InstallCache } from '../../harness/kokoroResourceBoundary';

type Cache = ReturnType<typeof InstallCache>;
type ProviderModule = typeof import('../../../pro/audio/ttsDownloadProvider');
type StoreModule = typeof import('../../../pro/audio/ttsStore');

let cache: Cache;
let ttsProvider: ProviderModule['ttsProvider'];
let useTTSStore: StoreModule['useTTSStore'];

beforeEach(async () => {
  jest.resetModules();
  cache = require('../../harness/kokoroResourceBoundary').installKokoroResourceBoundary();
  ({ ttsProvider } = require('../../../pro/audio/ttsDownloadProvider') as ProviderModule);
  ({ useTTSStore } = require('../../../pro/audio/ttsStore') as StoreModule);
  // Kokoro is the chosen voice engine, as the voice settings screen sets it.
  await useTTSStore.getState().setEngine('kokoro');
});

const kokoro = async () => (await ttsProvider.list()).find(d => d.id === 'tts:kokoro');

/** The Voice panel's Download button. */
const download = () => useTTSStore.getState().downloadModels();

describe('ttsProvider', () => {
  it('omits Kokoro before anything was downloaded', async () => {
    expect(await kokoro()).toBeUndefined();
  });

  it('lists a downloaded engine as completed; retry supported, cancel is not', async () => {
    cache.seedVoice();
    await download();

    const d = await kokoro();
    expect(d).toEqual(expect.objectContaining({ id: 'tts:kokoro', name: 'Kokoro TTS', status: 'completed', progress: 1 }));
    expect(d!.capabilities).toEqual({ cancel: false, retry: true, remove: true, resumable: true, determinateProgress: false });
  });

  it('lists an in-progress download as downloading with fractional progress, then completed', async () => {
    const finish = cache.holdNext(0.4);
    const running = download();
    await new Promise(resolve => setImmediate(resolve));

    const d = await kokoro();
    expect(d).toEqual(expect.objectContaining({ status: 'downloading', progress: 0.4 }));
    expect(d!.bytesDownloaded).toBeLessThan(d!.sizeBytes);

    finish();
    await running;
    expect((await kokoro())?.status).toBe('completed');
  });

  it('surfaces a FAILED download as status "error" with the failure message', async () => {
    // Regression: a failed Kokoro fetch used to vanish from the Download Manager. It must show as a
    // retryable error carrying the engine's failure message.
    cache.failFetch(new Error('Download interrupted or missing resource'));
    await download().catch(() => {});

    const d = await kokoro();
    expect(d?.status).toBe('error');
    expect(d?.error).toBe('Download interrupted or missing resource');
    expect(d?.capabilities.retry).toBe(true);
  });

  it('retry re-runs the download, and the failed row becomes completed', async () => {
    cache.failFetch(new Error('Download interrupted'));
    await download().catch(() => {});
    expect((await kokoro())?.status).toBe('error');

    cache.failFetch(undefined);
    await ttsProvider.retry('tts:kokoro');

    expect((await kokoro())?.status).toBe('completed');
  });

  it('remove deletes the voice files through the TTS store', async () => {
    cache.seedVoice();
    await download();
    expect(cache.files.size).toBeGreaterThan(0);

    await ttsProvider.remove('tts:kokoro');

    expect(cache.files.size).toBe(0);
    expect(await kokoro()).toBeUndefined();
  });
});
