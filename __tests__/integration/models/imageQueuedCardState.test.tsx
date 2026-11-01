/**
 * BUG #33 regression — the Image Models tab card must reflect a QUEUED / in-flight
 * image download.
 *
 * Root cause: the image ZIP download path (`proceedWithDownload`) used to `await`
 * `backgroundDownloadService.startDownload(...)` FIRST and only then publish the store
 * entry the card reads. While a download waited for a concurrency slot (queued at the
 * cap), `startDownload` had not resolved, so there was NO store entry under
 * `makeImageModelKey(id)` — the card fell back to the plain download arrow even though
 * the Download Manager (which reads the queue directly) correctly listed it as queued.
 *
 * This integration test fills the REAL backgroundDownloadService's three download slots with
 * real text downloads, so the image download genuinely waits in its queue, then drives the REAL
 * `proceedWithDownload` against the REAL `useDownloadStore`, modelManager and hardwareService,
 * and renders the REAL `ImageModelCardItem`. Only the phone is faked (installNativeBoundary: the
 * native background downloader, the disk, RAM). The assertion is keyed off the real write path.
 *
 * Fails-before (no early store row → card shows the download button, no Queued label);
 * passes-after (early queued row → card shows the Queued label, no download button).
 */
import { installNativeBoundary, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';

const MODEL_ID = 'stabilityai/sd-turbo-onnx';

const descriptor = {
  id: MODEL_ID,
  name: 'SD Turbo',
  description: 'fast image model',
  size: 1_000_000,
  style: 'realistic',
  backend: 'mnn' as const,
  downloadUrl: 'https://example.com/sd-turbo.zip',
};

// Minimal HFImageModel the card renders from — id must match the descriptor so the card's
// makeImageModelKey(model.id) lookup targets the row the download writes.
const hfModel: any = {
  id: MODEL_ID,
  displayName: 'SD Turbo',
  size: 1_000_000,
  backend: 'mnn',
};

let boundary: NativeBoundary;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

/** Three text downloads already hold every download slot; then the person taps download on the image model. */
async function queueImageDownloadBehindFullSlots(): Promise<void> {
  boundary = installNativeBoundary({ download: true, fs: true });
  const { startModelDownload } = require('../../../src/services/startModelDownload');
  for (const name of ['a', 'b', 'c']) {
    startModelDownload(`org/${name}`, {
      name: `${name}.gguf`, size: 1000, quantization: 'Q4_K_M',
      downloadUrl: `https://huggingface.co/org/${name}/resolve/main/${name}.gguf`,
    }).catch(() => {});
  }
  await settle();
  expect(boundary.download!.active()).toHaveLength(3);

  const { proceedWithDownload } = require('../../../src/services/imageDownloadActions');
  const { useAppStore } = require('../../../src/stores');
  const appState = useAppStore.getState();
  proceedWithDownload(descriptor, {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    setActiveImageModelId: appState.setActiveImageModelId,
    setAlertState: () => {},
    triedImageGen: false,
  }).catch(() => {});
  await settle();
}

describe('BUG #33 — image card reflects queued download (real store + real card)', () => {
  it('publishes a queued store row under makeImageModelKey while the download waits for a slot', async () => {
    await queueImageDownloadBehindFullSlots();
    const { useDownloadStore, isActiveStatus, isQueuedStatus } = require('../../../src/stores/downloadStore');
    const { makeImageModelKey } = require('../../../src/utils/modelKey');

    // The native start has not happened: the image download is waiting in the queue.
    expect(boundary.download!.active().some(row => row.modelId?.includes('sd-turbo'))).toBe(false);
    const entry = useDownloadStore.getState().downloads[makeImageModelKey(MODEL_ID)];
    // This is the exact key mismatch the bug was about: the row MUST exist under the
    // card's key while still queued.
    expect(entry).toBeDefined();
    expect(isActiveStatus(entry.status)).toBe(true);
    expect(isQueuedStatus(entry.status)).toBe(true);
  });

  it('renders the card as Queued (not the download button) while queued', async () => {
    await queueImageDownloadBehindFullSlots();
    const React = require('react');
    const { render } = requireRTL();
    const { ImageModelCardItem } = require('../../../src/screens/ModelsScreen/ImageModelsTab');

    const { queryByLabelText, queryByTestId } = render(
      React.createElement(ImageModelCardItem, {
        model: hfModel,
        index: 0,
        imageRec: null,
        isRecommendedModel: () => false,
        handleDownloadImageModel: () => {},
        handleCancelImageDownload: () => {},
      }),
    );
    // isQueued path renders an Icon with accessibilityLabel="Queued".
    expect(queryByLabelText('Queued')).not.toBeNull();
    // And the plain download affordance must NOT be offered.
    expect(queryByTestId('image-model-card-0-download')).toBeNull();
  });
});
