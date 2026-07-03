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
 * This integration test drives the REAL `proceedWithDownload` against the REAL
 * `useDownloadStore` with a native start that stays pending (== queued at the cap), then
 * renders the REAL `ImageModelCardItem` and asserts it reads the entry, keyed off the
 * SAME `makeImageModelKey(id)` the download writes. Mocking only the native boundary and
 * the id-mismatch is exactly what the bug was, so a hand-made store entry under the
 * card's assumed key would fake-green — we key the assertion off the real write path.
 *
 * Fails-before (no early store row → card shows the download button, no Queued label);
 * passes-after (early queued row → card shows the Queued label, no download button).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// --- Native boundary + file-system boundary mocks only ---------------------------------
jest.mock('react-native-fs', () => ({
  // The model dir does NOT exist yet, so proceedWithDownload takes the download branch
  // (not the "already on disk" register branch).
  exists: jest.fn(() => Promise.resolve(false)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 500000 })),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/unzipped')),
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any) => ({ visible: true, title, message, buttons })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

// A never-resolving native start === a download sitting in the queue waiting for a slot.
// The store row must appear BEFORE this promise settles, which is the whole fix.
const mockStartDownload = jest.fn((_params: any) => new Promise<any>(() => {}));
const mockOnComplete = jest.fn((_id: string, _cb: any) => jest.fn());
const mockOnError = jest.fn((_id: string, _cb: any) => jest.fn());

jest.mock('../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: () => '/mock/image-models',
    addDownloadedImageModel: jest.fn(() => Promise.resolve()),
  },
  hardwareService: { getSoCInfo: jest.fn(() => Promise.resolve({ hasNPU: true })) },
  backgroundDownloadService: {
    startDownload: (params: any) => mockStartDownload(params),
    onComplete: (id: string, cb: any) => mockOnComplete(id, cb),
    onError: (id: string, cb: any) => mockOnError(id, cb),
    startProgressPolling: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
  },
}));

// REAL store, REAL key helper, REAL card, REAL download action.
import { useDownloadStore, isActiveStatus, isQueuedStatus } from '../../../src/stores/downloadStore';
import { makeImageModelKey } from '../../../src/utils/modelKey';
import { proceedWithDownload } from '../../../src/screens/ModelsScreen/imageDownloadActions';
import { ImageModelCardItem } from '../../../src/screens/ModelsScreen/ImageModelsTab';
import { makeImageDownloadDeps } from '../../utils/factories';

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

const renderCard = () =>
  render(
    <ImageModelCardItem
      model={hfModel}
      index={0}
      imageRec={null}
      isRecommendedModel={() => false}
      handleDownloadImageModel={jest.fn()}
      handleCancelImageDownload={jest.fn()}
    />,
  );

describe('BUG #33 — image card reflects queued download (real store + real card)', () => {
  beforeEach(() => {
    // Reset the real store between tests.
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} });
    jest.clearAllMocks();
  });

  it('publishes a queued store row under makeImageModelKey BEFORE the native start resolves', async () => {
    // Kick off the (queued) download. Do NOT await — startDownload never resolves.
    proceedWithDownload(descriptor, makeImageDownloadDeps());
    // Let the synchronous store publish + the microtask up to the awaited startDownload run.
    await Promise.resolve();
    await Promise.resolve();

    const entry = useDownloadStore.getState().downloads[makeImageModelKey(MODEL_ID)];
    // This is the exact key mismatch the bug was about: the row MUST exist under the
    // card's key while still queued.
    expect(entry).toBeDefined();
    expect(isActiveStatus(entry!.status)).toBe(true);
    expect(isQueuedStatus(entry!.status)).toBe(true);
  });

  it('renders the card as Queued (not the download button) while queued', async () => {
    proceedWithDownload(descriptor, makeImageDownloadDeps());
    await Promise.resolve();
    await Promise.resolve();

    const { queryByLabelText, queryByTestId } = renderCard();
    // isQueued path renders an Icon with accessibilityLabel="Queued".
    expect(queryByLabelText('Queued')).not.toBeNull();
    // And the plain download affordance must NOT be offered.
    expect(queryByTestId('image-model-card-0-download')).toBeNull();
  });
});
