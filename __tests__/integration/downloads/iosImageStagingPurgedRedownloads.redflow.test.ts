/**
 * RED-FLOW (integration) — image-model download stuck "failed" after the completed bytes are lost.
 *
 * DEVICE GROUND TRUTH (iOS, production build): SDXL (Core ML) completed (2.8/2.8 GB) then showed
 * "…coreml_apple_…xl-base-ios couldn't be opened because there is no such file", and Retry did
 * nothing. Root cause (native, fixed separately): the completed file was staged in
 * NSTemporaryDirectory(), which iOS purges across relaunch — so finalize (moveCompletedDownload →
 * unzip) ran against a file the OS had deleted.
 *
 * This guards the shared JS half: when the completed bytes are unrecoverable (native
 * moveCompletedDownload rejects "no such file" AND no valid zip/extracted dir survives on disk),
 * the retry-finalize path must RE-DOWNLOAD from scratch instead of dead-ending. Before the fix,
 * resumeZipDownload rethrew and the row stuck at 'failed' with no fresh download.
 *
 * resumeImageDownload is SHARED (it runs on iOS retry AND on Android app-open resume), so this runs
 * on BOTH platforms with a device-faithful fixture each (iOS = CoreML zip; Android = MNN zip). The
 * fallback is additive: on the normal Android path moveCompletedDownload succeeds and this branch
 * never fires, so this only makes the FAILURE case recover instead of dead-end — on both platforms.
 *
 * Falsifier: revert the reDownloadFromMetadata fallback in imageDownloadResume → the entry stays
 * 'failed' and no new native download row appears → RED (verified on both platforms).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const FIXTURES = {
  ios: {
    modelId: 'coreml_apple_coreml-stable-diffusion-xl-base-ios',
    backend: 'coreml',
    name: 'SDXL (iOS)',
    downloadUrl: 'https://huggingface.co/apple/coreml-stable-diffusion-xl-base-ios/resolve/main/split_einsum/compiled.zip',
  },
  android: {
    modelId: 'anythingv5-mnn',
    backend: 'mnn',
    name: 'Anything V5 (MNN)',
    downloadUrl: 'https://example.com/models/anythingv5-mnn.zip',
  },
} as const;

describe.each(['ios', 'android'] as const)(
  'image staging purged — retry re-downloads instead of dead-ending, on %s (red-flow)',
  (platform) => {
    afterEach(() => {
      const { Platform } = require('react-native');
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    });

    it('re-issues a fresh download when the completed bytes are gone at finalize', async () => {
      const boundary = installNativeBoundary({ download: true, fs: true });
      const { Platform } = require('react-native');
      Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
      const { useDownloadStore, isActiveStatus } = require('../../../src/stores/downloadStore');
      const { useAppStore } = require('../../../src/stores');
      const { makeImageModelKey } = require('../../../src/utils/modelKey');
      const { resumeImageDownload } = require('../../../src/screens/ModelsScreen/imageDownloadResume');

      const fx = FIXTURES[platform];
      const fileName = `${fx.modelId}.zip`;
      const modelKey = makeImageModelKey(fx.modelId);
      const total = 2.8 * 1024 * 1024 * 1024;

      // A completed image zip download that failed finalize: bytes fully present, marked 'failed'.
      // metadata carries a real download URL (the zip download type) so a re-download is possible.
      useDownloadStore.getState().add({
        modelKey,
        downloadId: 'dl-img',
        modelId: `image:${fx.modelId}`,
        fileName,
        quantization: '',
        modelType: 'image',
        status: 'failed',
        bytesDownloaded: total,
        totalBytes: total,
        combinedTotalBytes: total,
        progress: 1,
        createdAt: 1,
        metadataJson: JSON.stringify({
          imageDownloadType: 'zip',
          imageModelName: fx.name,
          imageModelDescription: 'test model',
          imageModelSize: total,
          imageModelStyle: 'realistic',
          imageModelBackend: fx.backend,
          imageModelAttentionVariant: 'split_einsum',
          imageModelDownloadUrl: fx.downloadUrl,
        }),
      });

      // BOUNDARY (the device fact this reproduces): the completed file was staged and then lost
      // (iOS temp purge / storage clear), so the native move of the staged source now fails
      // "no such file". Nothing valid survives on disk — the unrecoverable case.
      boundary.download!.module.moveCompletedDownload.mockRejectedValue(
        new Error(`The file "download_dl-img_${fileName}" couldn't be opened because there is no such file.`),
      );

      const entry = useDownloadStore.getState().downloads[modelKey];
      const appState = useAppStore.getState();
      const deps = {
        addDownloadedImageModel: appState.addDownloadedImageModel,
        activeImageModelId: appState.activeImageModelId,
        setActiveImageModelId: appState.setActiveImageModelId,
        setAlertState: () => {},
        triedImageGen: false,
      };

      // Precondition: no native download in flight, and the row is a dead 'failed' (the screenshot state).
      expect(boundary.download!.active().length).toBe(0);
      expect(useDownloadStore.getState().downloads[modelKey].status).toBe('failed');

      // ACT: the retry/resume-finalize path for an all-bytes-present image download.
      await resumeImageDownload(entry, deps);

      // Recovery: a FRESH download is now in flight (real native row) and the row is active again —
      // not stuck 'failed'. RED before the fix: no new row, status stays 'failed'.
      const rows = boundary.download!.active();
      expect(rows.some(r => r.modelId === `image:${fx.modelId}` || r.fileName === fileName)).toBe(true);
      expect(isActiveStatus(useDownloadStore.getState().downloads[modelKey].status)).toBe(true);
      expect(useDownloadStore.getState().downloads[modelKey].status).not.toBe('failed');
    });
  },
);
