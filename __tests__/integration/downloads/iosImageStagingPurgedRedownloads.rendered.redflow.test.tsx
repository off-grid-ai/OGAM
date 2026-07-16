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
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('rendered — iOS image staging purged: Retry recovers the failed card', () => {
  it('taps Retry on the failed SDXL card and the download recovers (not stuck failed)', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    // The device bug is iOS (Core ML, production build). Pin the platform so imageProvider.retry takes
    // the iOS path (imageOps.retry → resume/finalize) and not the Android native-resume branch.
    const { Platform } = require('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { render, waitFor, fireEvent } = requireRTL();
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { makeImageModelKey } = require('../../../src/utils/modelKey');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    // The download service has no providers until the app registers them at startup — without this
    // modelDownloadService.retry() finds no owning provider and silently refuses (status stays failed).
    registerCoreDownloadProviders();

    const modelId = 'coreml_apple_coreml-stable-diffusion-xl-base-ios';
    const fileName = `${modelId}.zip`;
    const modelKey = makeImageModelKey(modelId);
    const total = 2.8 * 1024 * 1024 * 1024;

    // A completed CoreML zip download that failed finalize: bytes fully present, status 'failed', no
    // errorCode (so it renders as retryable — the failed card shows the Retry button).
    useDownloadStore.getState().add({
      modelKey, downloadId: 'dl-sdxl', modelId: `image:${modelId}`, fileName,
      quantization: '', modelType: 'image', status: 'failed',
      bytesDownloaded: total, totalBytes: total, combinedTotalBytes: total, progress: 1, createdAt: 1,
      metadataJson: JSON.stringify({
        imageDownloadType: 'zip', imageModelName: 'SDXL (iOS)', imageModelDescription: 'test',
        imageModelSize: total, imageModelStyle: 'realistic', imageModelBackend: 'coreml',
        imageModelAttentionVariant: 'split_einsum',
        imageModelRepo: 'apple/coreml-stable-diffusion-xl-base-ios',
        imageModelDownloadUrl: 'https://huggingface.co/apple/coreml-stable-diffusion-xl-base-ios/resolve/main/split_einsum/compiled.zip',
      }),
    });

    // BOUNDARY: the staged completed file was purged, so the native move now fails "no such file",
    // and nothing valid survives on disk — the unrecoverable case that trapped retry.
    boundary.download!.module.moveCompletedDownload.mockRejectedValue(
      new Error(`The file "download_dl-sdxl_${fileName}" couldn't be opened because there is no such file.`),
    );

    const view = render(React.createElement(DownloadManagerScreen, {}));

    // Precondition: the failed SDXL card is on screen WITH a Retry button (the screenshot state).
    const retry = await waitFor(() => {
      const btn = view.queryByTestId('failed-retry-button');
      expect(btn).not.toBeNull();
      return btn;
    });
    expect(view.queryByText(/SDXL|coreml_apple/)).not.toBeNull();
    expect(boundary.download!.active().length).toBe(0);

    // GESTURE: tap Retry, the way the user did on the device.
    fireEvent.press(retry!);

    // RECOVERY (what the user should now see): the Retry button is gone because the row is no longer
    // failed — a fresh download is in flight. RED before the fix: still failed, Retry still there, no
    // new download row.
    await waitFor(() => {
      expect(useDownloadStore.getState().downloads[modelKey].status).not.toBe('failed');
    }, { timeout: 5000 });
    expect(view.queryByTestId('failed-retry-button')).toBeNull();
    const rows = boundary.download!.active();
    expect(rows.some(r => r.modelId === `image:${modelId}` || r.fileName === fileName)).toBe(true);
  });
});
