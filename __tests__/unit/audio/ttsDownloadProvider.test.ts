/**
 * TTS download provider (pro) — wraps the executorch engine under the uniform
 * contract. Verifies list maps downloaded/downloading/FAILED engines, capabilities
 * reflect the executorch gaps (cancel:false, determinateProgress:false) while retry
 * IS supported (re-running downloadAssets resumes from cache), and remove/retry
 * route through the TTS store.
 */
const mockEngine = {
  displayName: 'Kokoro TTS',
  checkAssetStatus: jest.fn(async () => {}),
  isFullyDownloaded: jest.fn(() => true),
  getOverallDownloadProgress: jest.fn(() => 1),
  getPhase: jest.fn(() => 'ready'),
  getLastDownloadError: jest.fn(() => null as string | null),
  getRequiredAssets: jest.fn(() => [{ sizeBytes: 80_000_000 }]),
};
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getRegisteredIds: () => ['kokoro'], getEngine: () => mockEngine },
}));
const mockTts = {
  settings: { engineId: 'kokoro' },
  setEngine: jest.fn(async () => {}),
  deleteModels: jest.fn(async () => {}),
  downloadModels: jest.fn(async () => {}),
};
jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: { getState: () => mockTts, subscribe: () => () => {} },
}));

import { ttsProvider } from '../../../pro/audio/ttsDownloadProvider';

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.isFullyDownloaded.mockReturnValue(true);
  mockEngine.getOverallDownloadProgress.mockReturnValue(1);
  mockEngine.getPhase.mockReturnValue('ready');
  mockEngine.getLastDownloadError.mockReturnValue(null);
});

describe('ttsProvider', () => {
  it('lists a downloaded engine as completed; retry supported, cancel is not', async () => {
    const d = (await ttsProvider.list())[0];
    expect(d.id).toBe('tts:kokoro');
    expect(d.status).toBe('completed');
    expect(d.capabilities.cancel).toBe(false);
    expect(d.capabilities.retry).toBe(true);
    expect(d.capabilities.determinateProgress).toBe(false);
    expect(d.capabilities.resumable).toBe(true);
  });

  it('surfaces a FAILED download as status "error" with the failure message', async () => {
    // Regression: a failed Kokoro fetch used to vanish from the Download Manager
    // (list() dropped anything not downloaded/downloading). It must now show as a
    // retryable error carrying the engine's failure message.
    mockEngine.isFullyDownloaded.mockReturnValue(false);
    mockEngine.getOverallDownloadProgress.mockReturnValue(0.3);
    mockEngine.getPhase.mockReturnValue('error');
    mockEngine.getLastDownloadError.mockReturnValue('Download interrupted or missing resource');
    const d = (await ttsProvider.list())[0];
    expect(d.status).toBe('error');
    expect(d.error).toBe('Download interrupted or missing resource');
    expect(d.capabilities.retry).toBe(true);
  });

  it('falls back to a generic error message when the engine reports none', async () => {
    mockEngine.isFullyDownloaded.mockReturnValue(false);
    mockEngine.getPhase.mockReturnValue('error');
    mockEngine.getLastDownloadError.mockReturnValue(null);
    const d = (await ttsProvider.list())[0];
    expect(d.status).toBe('error');
    expect(d.error).toBe('Download failed');
  });

  it('retry re-runs the download for the engine via the store', async () => {
    await ttsProvider.retry('tts:kokoro');
    // Already the active engine → no switch, just re-download.
    expect(mockTts.setEngine).not.toHaveBeenCalled();
    expect(mockTts.downloadModels).toHaveBeenCalled();
  });

  it('retry switches to the target engine first when it is not active', async () => {
    mockTts.settings.engineId = 'outetts';
    await ttsProvider.retry('tts:kokoro');
    expect(mockTts.setEngine).toHaveBeenCalledWith('kokoro');
    expect(mockTts.downloadModels).toHaveBeenCalled();
    mockTts.settings.engineId = 'kokoro';
  });

  it('lists an in-progress download as downloading with fractional progress', async () => {
    mockEngine.isFullyDownloaded.mockReturnValue(false);
    mockEngine.getPhase.mockReturnValue('downloading');
    mockEngine.getOverallDownloadProgress.mockReturnValue(0.4);
    const d = (await ttsProvider.list())[0];
    expect(d.status).toBe('downloading');
    expect(d.progress).toBe(0.4);
    expect(d.bytesDownloaded).toBe(Math.round(80_000_000 * 0.4));
  });

  it('omits an engine that is neither downloaded nor downloading', async () => {
    mockEngine.isFullyDownloaded.mockReturnValue(false);
    mockEngine.getPhase.mockReturnValue('idle');
    mockEngine.getOverallDownloadProgress.mockReturnValue(0);
    expect(await ttsProvider.list()).toHaveLength(0);
  });

  it('remove routes through the TTS store delete', async () => {
    await ttsProvider.remove('tts:kokoro');
    expect(mockTts.deleteModels).toHaveBeenCalled();
  });
});
