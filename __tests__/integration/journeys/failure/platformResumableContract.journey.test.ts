/**
 * FAILURE JOURNEY (platform capability) — the iOS-vs-Android resume difference is
 * DATA, not a leaked branch.
 *
 * Cluster D. The genuine OS gap (iOS foreground URLSession dies on app-kill; Android
 * WorkManager survives) must surface as a `resumable` capability flag on the uniform
 * ModelDownload, so ONE contract test guards both platforms. This drives the REAL
 * textProvider + imageProvider .list() with a REAL downloadStore entry, flipping only
 * Platform.OS (set BEFORE the module loads, since some capability sets are captured at
 * import), and asserts the flag — not that any `if (ios)` ran.
 *
 * Terminal artifact: resumable === (Platform.OS === 'android') for a native-row
 * download; a multi-file (synthetic row) download is NEVER resumable on either OS.
 * retry + remove stay available on BOTH platforms.
 */
jest.mock('../../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: { startProgressPolling: jest.fn(), cancelDownload: jest.fn(async () => {}) },
}));
jest.mock('../../../../src/services/modelManager', () => ({
  modelManager: { deleteImageModel: jest.fn(async () => {}) },
}));
jest.mock('../../../../src/services/activeModelService', () => ({
  activeModelService: { unloadImageModel: jest.fn(async () => {}) },
}));
jest.mock('../../../../src/services/hardware', () => ({
  hardwareService: { getModelTotalSize: jest.fn(() => 1000) },
}));
jest.mock('../../../../src/services/huggingface', () => ({ huggingFaceService: { getDownloadUrl: jest.fn(() => 'http://x') } }));

type OS = 'ios' | 'android';

/** Load a FRESH module graph pinned to a given Platform.OS, so import-time captured
 *  capability constants reflect that OS. Returns the providers + the SAME store
 *  instance those providers reference (critical: the store is per-module-graph). */
function loadFor(os: OS) {
  jest.resetModules();
  // Pin the REAL RN Platform.OS getter BEFORE any src module imports it, so
  // import-time captured capability constants (TEXT_CAPABILITIES) reflect this OS.
  const Platform = require('react-native').Platform;
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
  const { textProvider } = require('../../../../src/services/modelDownloadService/providers/textProvider');
  const { imageProvider } = require('../../../../src/services/modelDownloadService/providers/imageProvider');
  const { useDownloadStore } = require('../../../../src/stores/downloadStore');
  const { makeModelKey, makeImageModelKey } = require('../../../../src/utils/modelKey');
  return { textProvider, imageProvider, useDownloadStore, makeModelKey, makeImageModelKey };
}

describe('failure journey — resumable is capability DATA across platforms', () => {
  it('text download: resumable true on Android, false on iOS (one contract, both OSes)', async () => {
    for (const [os, expected] of [['android', true], ['ios', false]] as const) {
      const { textProvider, useDownloadStore, makeModelKey } = loadFor(os);
      const key = makeModelKey('org/repo', 'model.gguf');
      useDownloadStore.getState().add({
        modelKey: key, downloadId: 'dl-t', modelId: 'org/repo', fileName: 'model.gguf',
        quantization: 'Q4', modelType: 'text', status: 'failed', bytesDownloaded: 500,
        totalBytes: 1000, combinedTotalBytes: 1000, progress: 0.5, createdAt: 1, errorMessage: 'interrupted',
      });
      const rows = await textProvider.list();
      expect(rows[0].capabilities.resumable).toBe(expected);
      // retry + remove available regardless of OS.
      expect(rows[0].capabilities.retry).toBe(true);
      expect(rows[0].capabilities.remove).toBe(true);
    }
  });

  it('image zip resumable on Android, not on iOS; multi-file never resumable', async () => {
    // Android: zip resumable, multi-file not.
    let ctx = loadFor('android');
    let key = ctx.makeImageModelKey('sd21');
    ctx.useDownloadStore.getState().add({
      modelKey: key, downloadId: 'dl-i', modelId: 'image:sd21', fileName: 'sd21.zip', quantization: '',
      modelType: 'image', status: 'failed', bytesDownloaded: 500, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0.5, createdAt: 1,
    });
    let rows = await ctx.imageProvider.list();
    let zip = rows.find((r: any) => r.name.includes('sd21'));
    expect(zip.capabilities.resumable).toBe(true);

    ctx.useDownloadStore.getState().add({
      modelKey: ctx.makeImageModelKey('sd-mf'), downloadId: 'image-multi:sd-mf', modelId: 'image:sd-mf', fileName: 'sd-mf',
      quantization: '', modelType: 'image', status: 'failed', bytesDownloaded: 500, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0.5, createdAt: 1,
    });
    rows = await ctx.imageProvider.list();
    const mf = rows.find((r: any) => r.name.includes('sd-mf'));
    expect(mf.capabilities.resumable).toBe(false); // synthetic row: never resumable

    // iOS: zip NOT resumable, but retry + remove still offered.
    ctx = loadFor('ios');
    key = ctx.makeImageModelKey('sd21');
    ctx.useDownloadStore.getState().add({
      modelKey: key, downloadId: 'dl-i', modelId: 'image:sd21', fileName: 'sd21.zip', quantization: '',
      modelType: 'image', status: 'failed', bytesDownloaded: 500, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0.5, createdAt: 1,
    });
    rows = await ctx.imageProvider.list();
    zip = rows.find((r: any) => r.name.includes('sd21'));
    expect(zip.capabilities.resumable).toBe(false);
    expect(zip.capabilities.retry).toBe(true);
    expect(zip.capabilities.remove).toBe(true);
  });
});
