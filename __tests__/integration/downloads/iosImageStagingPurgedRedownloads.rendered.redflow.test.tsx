/**
 * RED-FLOW (UI, rendered) — the iOS image-download "stuck failed" bug at the pixel.
 *
 * DEVICE (production build): SDXL (Core ML) completed (2.8/2.8 GB) then showed a failed card with
 * "…couldn't be opened because there is no such file", and tapping Retry did nothing. Root cause:
 * the completed bytes were staged in NSTemporaryDirectory() (native, fixed separately) and lost;
 * finalize + every retry re-ran moveCompletedDownload on the dead download → same error.
 *
 * This mounts the REAL DownloadManagerScreen over the download-native + FS fakes, taps the REAL
 * Retry button a user taps, and asserts the card RECOVERS (no longer failed; a fresh download is in
 * flight). Before the JS fix, resumeZipDownload rethrew and the row stayed failed → the Retry button
 * is still there and no new download exists → RED. Fakes only at the native boundary; the real
 * screen, provider, retry wiring, resume/finalize, store and proceedWithDownload all run.
 */
import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const IMAGE_ID = 'coreml_apple_coreml-stable-diffusion-xl-base-ios';
const MODEL_ID = `image:${IMAGE_ID}`;
const FILE_NAME = `${IMAGE_ID}.zip`;
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TOTAL = 2.8 * 1024 * 1024 * 1024;
const METADATA = {
  imageDownloadType: 'zip',
  imageModelName: 'SDXL (iOS)',
  imageModelDescription: 'test',
  imageModelSize: TOTAL,
  imageModelStyle: 'realistic',
  imageModelBackend: 'coreml',
  imageModelAttentionVariant: 'split_einsum',
  imageModelRepo: 'apple/coreml-stable-diffusion-xl-base-ios',
  imageModelDownloadUrl:
    'https://huggingface.co/apple/coreml-stable-diffusion-xl-base-ios/resolve/main/split_einsum/compiled.zip',
};

let applicationFixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

function failedDownload(): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: FILE_NAME,
          role: 'primary',
          required: true,
          localName: FILE_NAME,
          url: METADATA.imageModelDownloadUrl,
          sizeBytes: TOTAL,
        },
      ],
      metadata: {
        displayName: METADATA.imageModelName,
        catalogEntry: true,
        publicMetadataJson: JSON.stringify(METADATA),
      },
    },
    phase: 'failed',
    artifacts: [
      {
        artifactId: 'primary',
        phase: 'failed',
        transferId: 'dl-sdxl',
        bytesDownloaded: TOTAL,
        totalBytes: TOTAL,
        error: 'The completed staging file no longer exists.',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

describe('rendered — iOS image staging purged: Retry recovers the failed card', () => {
  it('taps Retry on the failed SDXL card and the download recovers (not stuck failed)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    // The device bug is iOS (Core ML, production build). Pin the platform so imageProvider.retry takes
    // the iOS path (imageOps.retry → resume/finalize) and not the Android native-resume branch.
    const { Platform } = require('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { render, waitFor, fireEvent } = requireRTL();
    const {
      DownloadManagerScreen,
    } = require('../../../src/screens/DownloadManagerScreen');
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');

    await seedMobileDownloadJournal([failedDownload()]);
    boundary.download!.simulateRelaunch();
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();

    const view = render(React.createElement(DownloadManagerScreen, {}));

    // Precondition: the failed SDXL card is on screen WITH a Retry button (the screenshot state).
    const retry = await waitFor(() => {
      const btn = view.queryByTestId('failed-retry-button');
      expect(btn).not.toBeNull();
      return btn;
    });
    expect(view.queryByText(FILE_NAME)).not.toBeNull();
    expect(boundary.download!.active().length).toBe(0);

    // GESTURE: tap Retry, the way the user did on the device.
    fireEvent.press(retry!);

    // RECOVERY (what the user should now see): the Retry button is gone because the row is no longer
    // failed — a fresh download is in flight. RED before the fix: still failed, Retry still there, no
    // new download row.
    await waitFor(
      () => {
        expect(
          applicationFixture!.application.models
            .snapshot()
            .control.downloads.find(row => row.downloadId === DOWNLOAD_ID)
            ?.status,
        ).not.toBe('failed');
      },
      { timeout: 5000 },
    );
    expect(view.queryByTestId('failed-retry-button')).toBeNull();
    const rows = boundary.download!.active();
    expect(
      rows.some(r => r.modelId === MODEL_ID || r.fileName === FILE_NAME),
    ).toBe(true);
  });
});
