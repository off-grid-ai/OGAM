/**
 * Branch-coverage tests for downloadHydration.ts.
 * Targets the mapNativeStatus switch arms (retrying/waiting_for_network/default),
 * the image-completed -> 'processing' branch, and computeProgress denom fallbacks.
 *
 * The phone is the boundary: the native downloader's rows are what the device's download database holds
 * (harness/nativeBoundary). The background download service, the hydration and the store run for real.
 *
 * Not covered here: the per-row try/catch for a row that throws while it is read. The native bridge hands
 * over plain JSON, so a real row cannot throw there; the old test reached it only with a JS getter.
 */
import { installNativeBoundary, type DownloadRow } from '../../harness/nativeBoundary';

let hydrateDownloadStore: () => Promise<void>;
let downloads: () => Record<string, any>;

/** The app starts while the native downloader holds `rows`. */
async function relaunchWith(rows: Array<DownloadRow & Record<string, unknown>>) {
  const boundary = installNativeBoundary({ fs: true, download: true });
  rows.forEach(row => boundary.download!.seedActive(row));
  ({ hydrateDownloadStore } = require('../../../src/services/downloadHydration'));
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  downloads = () => useDownloadStore.getState().downloads;
  await hydrateDownloadStore();
}
const only = () => Object.values(downloads())[0];

describe('mapNativeStatus arms', () => {
  it("maps 'retrying' to 'failed'", async () => {
    await relaunchWith([
      { downloadId: 'r', modelId: 'a/b', fileName: 'b.gguf', status: 'retrying', bytesDownloaded: 1, totalBytes: 10, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.status).toBe('failed');
  });

  it("maps 'waiting_for_network' through unchanged", async () => {
    await relaunchWith([
      { downloadId: 'w', modelId: 'a/b', fileName: 'b.gguf', status: 'waiting_for_network', bytesDownloaded: 0, totalBytes: 10, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.status).toBe('waiting_for_network');
  });

  it('maps an unknown native status to the default "pending"', async () => {
    await relaunchWith([
      { downloadId: 'p', modelId: 'a/b', fileName: 'b.gguf', status: 'bogus' as any, bytesDownloaded: 0, totalBytes: 10, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.status).toBe('pending');
  });
});

describe('image-completed surfaces as processing', () => {
  it("turns a completed image row (modelType image) into 'processing'", async () => {
    await relaunchWith([
      { downloadId: 'img', modelId: 'image:foo', modelType: 'image', fileName: 'foo.zip', status: 'completed', bytesDownloaded: 100, totalBytes: 100, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.status).toBe('processing');
    expect(entry.modelType).toBe('image');
  });

  it("detects an image row via modelId 'image:' prefix even without modelType", async () => {
    await relaunchWith([
      { downloadId: 'img2', modelId: 'image:bar', fileName: 'bar.zip', status: 'completed', bytesDownloaded: 50, totalBytes: 100, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.status).toBe('processing');
  });
});

describe('computeProgress and field fallbacks', () => {
  it('returns 0 progress when denominator is 0', async () => {
    await relaunchWith([
      { downloadId: 'z', modelId: 'a/b', fileName: 'b.gguf', status: 'running', bytesDownloaded: 0, totalBytes: 0, combinedTotalBytes: 0, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.progress).toBe(0);
  });

  it('uses combinedTotalBytes over totalBytes and applies ?? fallbacks for missing fields', async () => {
    await relaunchWith([
      { downloadId: 'c', modelKey: 'k', fileName: 'b.gguf', status: 'running', totalBytes: 200, combinedTotalBytes: 400, createdAt: 1 },
    ]);
    const entry = downloads().k;
    expect(entry.modelId).toBe('');
    expect(entry.quantization).toBe('Unknown');
    expect(entry.modelType).toBe('text');
    expect(entry.bytesDownloaded).toBe(0);
    expect(entry.combinedTotalBytes).toBe(400);
    expect(entry.createdAt).toBe(1);
  });

  it('resolves mmProj bytes/status onto the parent entry', async () => {
    await relaunchWith([
      { downloadId: 'par', modelId: 'a/b', fileName: 'b.gguf', status: 'running', bytesDownloaded: 300, totalBytes: 1000, combinedTotalBytes: 1500, mmProjDownloadId: 'mm', createdAt: 1 },
      { downloadId: 'mm', modelId: 'a/b', fileName: 'b-mmproj.gguf', status: 'completed', bytesDownloaded: 200, totalBytes: 500, createdAt: 1 },
    ]);
    const entry = only();
    expect(entry.mmProjDownloadId).toBe('mm');
    expect(entry.mmProjBytesDownloaded).toBe(200);
    expect(entry.mmProjStatus).toBe('completed');
    // progress uses combined denom: (300 + 200) / 1500
    expect(entry.progress).toBeCloseTo(500 / 1500);
  });
});
