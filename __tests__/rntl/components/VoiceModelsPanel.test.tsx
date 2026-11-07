/**
 * VoiceModelsPanel tests
 *
 * The Voice model picker (Models screen tab + home/chat Voice sheet). Verifies:
 *  - the RAM privacy banner
 *  - not-downloaded → a single model download action (opt-in)
 *  - downloaded → the local model appears without speaker choices
 *  - live download progress, read from the same download service the Download Manager reads
 *
 * Everything that is ours runs for real: the panel, the real useTTSStore, the real Kokoro engine
 * from the real registry, the real TTS download provider registered into the real
 * ModelDownloadService by Pro's own activation (installPro), and the real hardware service.
 * Each test starts a fresh module graph (installNativeBoundary).
 *
 * Faked: only the device edges. RAM is the device-info reading installNativeBoundary seeds;
 * ExecuTorch's resource cache (installKokoroResourceBoundary) holds or completes the files.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { installKokoroResourceBoundary } from '../../harness/kokoroResourceBoundary';
import { installPro } from '../../harness/proHarness';

async function launch() {
  installNativeBoundary({ ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB } });
  const cache = installKokoroResourceBoundary();
  await installPro();
  const React = require('react');
  const rtl = requireRTL();
  const { VoiceModelsPanel } = require('../../../pro/audio/ui/VoiceModelsPanel');
  const { useTTSStore } = require('../../../pro/audio/ttsStore');
  const store = () => useTTSStore.getState();
  // App boot reads the device once; the panel's RAM banner reads that cached reading.
  await require('../../../src/services/hardware').hardwareService.getDeviceInfo();
  await rtl.act(async () => { await store().setEngine('kokoro'); });
  return {
    rtl,
    cache,
    store,
    async renderPanel() {
      const view = rtl.render(React.createElement(VoiceModelsPanel));
      await rtl.act(async () => { await Promise.resolve(); });
      return view;
    },
    /** The model is downloaded through the store's own download action. */
    async download() {
      await rtl.act(async () => { await store().downloadModels(); });
    },
  };
}

type App = Awaited<ReturnType<typeof launch>>;
let app: App;

beforeEach(async () => {
  app = await launch();
});

afterEach(async () => {
  await app.rtl.act(async () => {
    await require('../../../pro').deactivate();
  });
});

describe('VoiceModelsPanel', () => {
  it('shows the RAM privacy banner with the device RAM', async () => {
    const { getByText } = await app.renderPanel();
    await app.rtl.waitFor(() =>
      expect(getByText('8.0 GB RAM. Replies are read aloud on this phone, and your voice never leaves it.')).toBeTruthy(),
    );
  });

  it('shows the installed model without speaker choices', async () => {
    await app.download();
    const { getByTestId, getByText, queryByTestId } = await app.renderPanel();
    expect(getByTestId('voice-model-kokoro')).toBeTruthy();
    expect(getByText('Kokoro TTS')).toBeTruthy();
    expect(queryByTestId('voice-af_heart')).toBeNull();
    expect(queryByTestId('models-tts-language')).toBeNull();
  });

  it('shows an opt-in download when the model is not downloaded, and the download fetches it', async () => {
    const { getByTestId, findByTestId } = await app.renderPanel();

    const cta = getByTestId('voice-model-kokoro-download');
    await app.rtl.act(async () => { app.rtl.fireEvent.press(cta); });

    // The model files reached the device cache, and the panel now offers to remove the model.
    await findByTestId('voice-model-kokoro-delete');
    expect(app.cache.files.size).toBeGreaterThan(0);
    expect(app.store().settings.modelDownloaded.kokoro).toBe(true);
  });

  it('shows the model as downloaded when the service reports completed, even if the engine is not loaded', async () => {
    // Regression for the Download-Manager-vs-Voice-panel mismatch: the service is
    // the single source. When it says 'completed', the panel shows the model — never a
    // stale 0% progress bar — regardless of the engine being loaded.
    await app.download();
    expect(app.store().isReady).toBe(false); // no bridge mounted: not loaded
    const { getByTestId, queryByText } = await app.renderPanel();
    expect(getByTestId('voice-model-kokoro')).toBeTruthy();
    expect(queryByText('Download voice model')).toBeNull();
    expect(queryByText('0%')).toBeNull();
  });

  it('shows live progress while the service reports downloading', async () => {
    // The transfer reports 40% and waits.
    const finish = app.cache.holdNext(0.4);
    let download!: Promise<void>;
    await app.rtl.act(async () => { download = app.store().downloadModels(); });
    const { getByText, queryByText } = await app.renderPanel();
    await app.rtl.waitFor(() => expect(getByText('40%')).toBeTruthy());
    // ExecuTorch's fetcher reports a fraction only, so no byte rate shows.
    expect(queryByText('Rate unavailable')).toBeNull();
    expect(queryByText(/NaN/)).toBeNull();
    expect(queryByText('Download voice model')).toBeNull();
    await app.rtl.act(async () => { finish(); await download; });
  });

  it('backfills the persisted-downloaded flag from disk when the panel opens', async () => {
    // A model downloaded by a build that predates the flag: its files are on disk and the engine
    // knows it, but nothing was saved. Opening the panel checks the disk and saves the flag.
    await app.download();
    await app.rtl.act(async () => {
      app.store().updateSettings({ modelDownloaded: { kokoro: false } });
    });
    await app.renderPanel();
    await app.rtl.waitFor(() => expect(app.store().settings.modelDownloaded.kokoro).toBe(true));
  });
});
