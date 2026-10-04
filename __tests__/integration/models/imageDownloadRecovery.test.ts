/**
 * Image download recovery over the REAL Mobile composition root and the REAL Shared coordinator.
 *
 * The retired `coordinatedDownloadBridge` / `hydrateDownloadStore` / `resumeImageDownload` trio is
 * gone: Shared owns download state (`models.snapshot().control.downloads`) and Mobile projects it
 * into `useDownloadStore` (downloadProjectionAdapter). A relaunch finds the durable journal row
 * still `downloading` while the native transfer already reports `completed`; Shared attaches,
 * the transfer port promotes the staged bytes over whatever stale zip sits at the destination,
 * the image finalizer extracts + registers the model, and the row leaves the active projection.
 * Fakes sit ONLY at the device boundary: background-download native, react-native-fs, and the
 * zip-archive leaf (react-native-zip-archive writes the extracted files to the faked disk).
 */
import type {PersistedModelDownload} from '@offgrid/models';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'image:test-model';
const IMAGE_ID = 'test-model';
const FILE_NAME = 'test-model.zip';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'dl-1';
const DOCS = '/docs';
const ZIP_PATH = `${DOCS}/${FILE_NAME}`;
const MODEL_DIR = `${DOCS}/image_models/${IMAGE_ID}`;
const ZIP_BYTES = 1_000;
/** Zip image metadata as the catalog emits it: the archive URL is mandatory (mobileImageDownloadMetadata). */
const METADATA = {
  imageDownloadType: 'zip',
  imageModelDownloadUrl: `https://example.com/${FILE_NAME}`,
  imageModelName: 'Test Model',
  imageModelDescription: 'desc',
  imageModelSize: ZIP_BYTES,
  imageModelBackend: 'mnn',
};
/** A complete MNN package as the integrity gate (imageModelIntegrity) requires it. */
const MNN_FILES = [
  'pos_emb.bin', 'token_emb.bin', 'tokenizer.json',
  'unet.mnn', 'unet.mnn.weight',
  'vae_decoder.mnn', 'vae_decoder.mnn.weight',
  'clip_v2.mnn', 'clip_v2.mnn.weight',
];

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(phase: PersistedModelDownload['phase'], transferId?: string): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [{
        id: 'primary',
        name: FILE_NAME,
        role: 'primary',
        required: true,
        localName: FILE_NAME,
        url: `https://example.com/${FILE_NAME}`,
        sizeBytes: ZIP_BYTES,
      }],
      metadata: {
        displayName: 'Test Model',
        catalogEntry: false,
        publicMetadataJson: JSON.stringify(METADATA),
      },
    },
    phase,
    artifacts: [{
      artifactId: 'primary',
      phase,
      ...(transferId ? {transferId} : {}),
      bytesDownloaded: ZIP_BYTES,
      totalBytes: ZIP_BYTES,
    }],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

/**
 * Device boundary for a completed native transfer: the native module reports the row `completed`,
 * `moveCompletedDownload` promotes the staged bytes over the destination (replacing any stale file
 * there, as the OS does), and the zip leaf extracts a complete MNN package onto the faked disk.
 */
function installCompletedImageTransfer() {
  const boundary = installNativeBoundary({download: true, fs: true});
  const fs = boundary.fs!;
  boundary.download!.seedActive({
    downloadId: TRANSFER_ID,
    modelId: MODEL_ID,
    fileName: FILE_NAME,
    modelType: 'image',
    status: 'completed',
    bytesDownloaded: ZIP_BYTES,
    totalBytes: ZIP_BYTES,
  });
  boundary.download!.module.moveCompletedDownload.mockImplementation(async (_id: string, target: string) => {
    fs.seedTextFile(target, 'PK', ZIP_BYTES);
    return target;
  });
  const zip = require('react-native-zip-archive') as {unzip: jest.Mock};
  zip.unzip.mockImplementation(async (_archive: string, destination: string) => {
    for (const name of MNN_FILES) fs.seedFile(`${destination}/${name}`, 1);
    return destination;
  });
  return {boundary, fs, unzip: zip.unzip};
}

async function launch(records: readonly PersistedModelDownload[]) {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projected() {
  const {useDownloadStore} = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

function installedImageModels() {
  const {useAppStore} = require('../../../src/stores/appStore') as typeof import('../../../src/stores/appStore');
  return useAppStore.getState().downloadedImageModels;
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise<void>(resolve => setImmediate(resolve));
}

describe('image download recovery (real composition root + Shared-owned download state)', () => {
  it('recovers a completed native image transfer on relaunch by replacing an invalid destination zip, extracting, and registering the model', async () => {
    const {boundary, fs, unzip} = installCompletedImageTransfer();
    // A stale, invalid zip already sits at the destination from an earlier attempt.
    fs.seedTextFile(ZIP_PATH, 'NOPE', 128);

    await launch([record('downloading', TRANSFER_ID)]);
    boundary.download!.events.emit('DownloadComplete', {downloadId: TRANSFER_ID});
    await settle();

    // The staged native bytes were promoted over the invalid destination file.
    expect(boundary.download!.module.moveCompletedDownload).toHaveBeenCalledWith(TRANSFER_ID, ZIP_PATH);
    expect(await fs.readAscii(ZIP_PATH, 2)).toBe('PK');
    // The archive was extracted and the image model registered at its install path.
    expect(installedImageModels()).toEqual([expect.objectContaining({
      id: IMAGE_ID,
      modelPath: MODEL_DIR,
    })]);
    expect(unzip).toHaveBeenCalledWith(ZIP_PATH, expect.stringContaining('prepared-image'));
    expect(await fs.exists(`${MODEL_DIR}/unet.mnn`)).toBe(true);
    expect(await AsyncStorage.getItem('@local_llm/downloaded_model_packages')).toBeNull();
    const storedRows = await AsyncStorage.getItem('@local_llm/downloaded_image_models');
    expect(storedRows).not.toBeNull();
    const canonicalRows = JSON.parse(storedRows!);
    expect(canonicalRows).toEqual([expect.objectContaining({
      id: IMAGE_ID,
      modelPath: MODEL_DIR,
      registryFamilyId: MODEL_ID,
      registryPackageIdentity: expect.stringMatching(/^model-package-v1:/),
    })]);
    // The recovered download is no longer an active row the Download Manager renders.
    expect(projected().filter(row => row.status !== 'completed')).toEqual([]);
    expect(fixture!.application.models.snapshot().control.downloads
      .filter(row => row.status !== 'completed' && row.status !== 'cancelled')).toEqual([]);
  });
});
