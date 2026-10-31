/**
 * Repair-Vision Progress Tests
 *
 * BUG OD2: the "Repair Vision" action re-downloads a model's missing mmproj
 * (~900MB) but showed only an indeterminate spinner. It must drive the SAME
 * determinate-progress store the normal download uses, so the existing
 * progress-bar UI (ActiveDownloadCard) lights up.
 *
 * These tests drive the REAL useDownloadStore and assert the store entry's
 * `progress` advances incrementally (0 -> mid -> complete). The phone is the boundary: the native
 * background downloader reports bytes as they arrive, and the disk and storage are fakes
 * (harness/modelManagerDevice). modelManager, the background download service and the stores
 * run for real.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { createModelFileWithMmProj } from '../../utils/factories';

const REPO = 'test/model';
const MODEL_NAME = 'vision-Q4_K_M.gguf';
const MMPROJ_NAME = 'mmproj-model-f16.gguf';
const MMPROJ_SIZE = 900_000_000; // ~900MB, the OD2 case
// The modelKey the completed model carries and the store keys on.
const MODEL_KEY = `${REPO}/${MODEL_NAME}`;

function visionFile() {
  return createModelFileWithMmProj({
    name: MODEL_NAME,
    size: 4_000_000_000,
    quantization: 'Q4_K_M',
    mmProjName: MMPROJ_NAME,
    mmProjSize: MMPROJ_SIZE,
    mmProjDownloadUrl: `https://huggingface.co/${REPO}/resolve/main/${MMPROJ_NAME}`,
  });
}

let device: ModelManagerDevice;
const store = () => require('../../../src/stores/downloadStore').useDownloadStore.getState();

/**
 * A vision model installed through the app's download path whose projector failed: it is
 * registered text-only, so Repair Vision has something to fetch.
 */
async function textOnlyVisionModel() {
  device = await installModelManagerDevice();
  const { textProvider } = require('../../../src/services/modelDownloadService/providers/textProvider');
  await textProvider.start({ modelType: 'text', modelId: REPO, file: visionFile() });
  await device.settle();
  const main = device.nativeRows().find(r => r.fileName === MODEL_NAME)!;
  const projector = device.nativeRows().find(r => r.downloadId !== main.downloadId)!;
  await device.failDownload(projector.downloadId, 'connection reset');
  await device.finishDownload(main.downloadId, 4_000_000_000);
}

/** Start Repair Vision; its outcome is held from the start, as it may fail mid-transfer. */
async function repairVision() {
  const ids: string[] = [];
  const outcome = device.modelManager
    .repairMmProj(REPO, visionFile(), { onDownloadIdReady: (id: string) => ids.push(id) })
    .then(() => null, (error: Error) => error);
  await device.settle();
  return { outcome, downloadId: ids[0] };
}

describe('repairMmProj — determinate progress (BUG OD2)', () => {
  it('drives the download store incrementally (0 -> mid -> complete), not just a terminal done', async () => {
    await textOnlyVisionModel();
    const { outcome, downloadId } = await repairVision();

    // The store must now hold an active entry for this model so the UI's
    // ActiveDownloadCard progress bar can render.
    const started = store().downloads[MODEL_KEY];
    expect(started).toBeDefined();
    expect(started.progress).toBe(0);

    // Bytes arrive at the native downloader.
    await device.reportProgress(downloadId, MMPROJ_SIZE / 2, MMPROJ_SIZE);
    expect(store().downloads[MODEL_KEY].progress).toBeCloseTo(0.5, 2);

    await device.reportProgress(downloadId, MMPROJ_SIZE * 0.9, MMPROJ_SIZE);
    expect(store().downloads[MODEL_KEY].progress).toBeCloseTo(0.9, 2);

    // Completion.
    await device.finishDownload(downloadId, MMPROJ_SIZE);
    expect(await outcome).toBeNull();
    const [model] = await device.readRegistry();
    expect(model).toEqual(expect.objectContaining({ isVisionModel: true, mmProjFileSize: MMPROJ_SIZE }));
  });

  it('reports failure through the store when the download errors', async () => {
    await textOnlyVisionModel();
    const { outcome, downloadId } = await repairVision();

    expect(store().downloads[MODEL_KEY]).toBeDefined();

    await device.failDownload(downloadId, 'Network error');

    expect((await outcome)?.message).toContain('Network error');
  });
});
