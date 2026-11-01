/**
 * modelManager's background download path, driven end to end over the native downloader.
 *
 * Fakes: the native background downloader (NativeModules.DownloadManagerModule), the disk
 * (react-native-fs over memfs) and async-storage — see harness/modelManagerDevice. modelManager,
 * backgroundDownloadService, the Hugging Face URL builder and the stores run for real. A model is
 * only "downloaded" when the app's own finalize moved the native file into the models folder and
 * wrote the registry.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { createModelFile, createModelFileWithMmProj } from '../../../utils/factories';
import type { DownloadedModel } from '../../../../src/types';

const GBYTES = 1024 * 1024 * 1024;

describe('modelManager background downloads', () => {
  let device: ModelManagerDevice;

  describe('on a platform without a background downloader', () => {
    beforeEach(async () => {
      device = await installModelManagerDevice({ backgroundDownloads: false });
    });

    it('refuses to start, cancel or sync, and reports no active downloads', async () => {
      const { modelManager } = device;
      expect(modelManager.isBackgroundDownloadSupported()).toBe(false);
      await expect(modelManager.downloadModelBackground('test/model', createModelFile())).rejects.toThrow(
        'Background downloads not supported',
      );
      await expect(modelManager.cancelBackgroundDownload('42')).rejects.toThrow('Background downloads not supported');
      await expect(modelManager.syncBackgroundDownloads({}, () => {})).resolves.toEqual([]);
      await expect(modelManager.getActiveBackgroundDownloads()).resolves.toEqual([]);
      // Polling is a no-op rather than a crash when there is no native module to poll.
      expect(() => modelManager.startBackgroundDownloadPolling()).not.toThrow();
      expect(() => modelManager.stopBackgroundDownloadPolling()).not.toThrow();
      expect(await device.readRegistry()).toEqual([]);
    });
  });

  describe('with the native downloader', () => {
    beforeEach(async () => {
      device = await installModelManagerDevice();
    });

    it('downloads a text model: the native transfer starts, reports progress, and finalize registers it', async () => {
      const { modelManager, modelsDir } = device;
      const file = createModelFile({ name: 'bg-model-Q4_K_M.gguf', size: 8 * GBYTES, quantization: 'Q4_K_M' });
      const metadata: Array<[string, unknown]> = [];
      modelManager.setBackgroundDownloadMetadataCallback((id, info) => { metadata.push([String(id), info]); });
      const progress: number[] = [];

      const info = await modelManager.downloadModelBackground('TheBloke/bg-model', file, p => progress.push(p.progress));
      const done: DownloadedModel[] = [];
      modelManager.watchDownload(info.downloadId, model => done.push(model));

      // Before: the native downloader holds one running transfer from the file's Hugging Face URL.
      expect(device.nativeRows()).toEqual([
        expect.objectContaining({ downloadId: info.downloadId, fileName: file.name, url: file.downloadUrl, status: 'running' }),
      ]);
      expect(metadata).toEqual([[info.downloadId, expect.objectContaining({ modelId: 'TheBloke/bg-model', fileName: file.name })]]);
      expect(await device.fs.exists(`${modelsDir}/${file.name}`)).toBe(false);

      await device.reportProgress(info.downloadId, 4 * GBYTES, 8 * GBYTES);
      expect(progress).toEqual([0.5]);
      expect(done).toEqual([]);

      await device.finishDownload(info.downloadId, 8 * GBYTES);

      // After: the file sits in the models folder and the registry holds the model.
      expect(await device.fs.exists(`${modelsDir}/${file.name}`)).toBe(true);
      expect(done).toEqual([expect.objectContaining({ id: `TheBloke/bg-model/${file.name}`, fileSize: 8 * GBYTES })]);
      expect(done[0].credibility?.source).toBe('verified-quantizer');
      expect(await device.readRegistry()).toEqual([expect.objectContaining({ id: `TheBloke/bg-model/${file.name}` })]);
      // The finished download hands its metadata slot back.
      expect(metadata.at(-1)).toEqual([info.downloadId, null]);
    });

    it('fetches a curated entry from its own downloadUrl, not one built from the parent model id', async () => {
      const customUrl =
        'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';
      const curated = createModelFile({ name: 'gemma-4-E2B-it.litertlm', size: 2_590_000_000, quantization: 'mixed', downloadUrl: customUrl });

      await device.modelManager.downloadModelBackground('offgrid/litert-recommended', curated);

      expect(device.nativeRows()).toEqual([expect.objectContaining({ url: customUrl, fileName: curated.name })]);
    });

    it('builds the Hugging Face URL from the model id when the file carries none', async () => {
      const file = { ...createModelFile({ name: 'plain-Q4_K_M.gguf' }), downloadUrl: '' };

      await device.modelManager.downloadModelBackground('someone/plain', file);

      expect(device.nativeRows()).toEqual([
        expect.objectContaining({ url: 'https://huggingface.co/someone/plain/resolve/main/plain-Q4_K_M.gguf' }),
      ]);
    });

    it('does not download again when the model and its projector are already on disk', async () => {
      const { modelManager, modelsDir, fs } = device;
      const file = createModelFile({ name: 'bg-model.gguf', size: 8_000_000_000 });
      fs.seedFile(`${modelsDir}/${file.name}`, 8_000_000_000);

      const info = await modelManager.downloadModelBackground('test/model', file);
      const done: DownloadedModel[] = [];
      modelManager.watchDownload(info.downloadId, model => done.push(model));
      await device.settle();

      expect(info.status).toBe('completed');
      expect(device.nativeRows()).toEqual([]);
      expect(done).toEqual([expect.objectContaining({ id: 'test/model/bg-model.gguf' })]);
      // A file found on disk is registered too, so it survives the next launch.
      expect(await device.readRegistry()).toEqual([expect.objectContaining({ id: 'test/model/bg-model.gguf' })]);
    });

    it('downloads a vision model and its projector side by side, and registers it only when both finish', async () => {
      const { modelManager, modelsDir } = device;
      const visionFile = createModelFileWithMmProj({
        name: 'vision-Q4_K_M.gguf', size: 4_000_000_000, mmProjName: 'mmproj-f16.gguf', mmProjSize: 500_000_000,
      });

      const info = await modelManager.downloadModelBackground('test/model', visionFile);
      const done: DownloadedModel[] = [];
      modelManager.watchDownload(info.downloadId, model => done.push(model));

      const rows = device.nativeRows();
      expect(rows.map(r => r.fileName).sort()).toEqual(['vision-Q4_K_M.gguf', 'vision-mmproj-f16.gguf']);
      const sidecar = rows.find(r => r.downloadId !== info.downloadId)!;

      await device.finishDownload(sidecar.downloadId, 500_000_000);
      expect(done).toEqual([]);
      expect(await device.readRegistry()).toEqual([]);

      await device.finishDownload(info.downloadId, 4_000_000_000);

      expect(done).toHaveLength(1);
      expect(done[0]).toEqual(expect.objectContaining({
        isVisionModel: true,
        mmProjPath: `${modelsDir}/vision-mmproj-f16.gguf`,
        mmProjFileSize: 500_000_000,
      }));
      expect(await device.fs.exists(`${modelsDir}/vision-mmproj-f16.gguf`)).toBe(true);
      expect(await device.fs.exists(`${modelsDir}/vision-Q4_K_M.gguf`)).toBe(true);
    });

    it('surfaces a failed transfer to the caller and registers nothing', async () => {
      const { modelManager } = device;
      const file = createModelFile({ name: 'bg-fail.gguf', size: 4_000_000_000 });
      const info = await modelManager.downloadModelBackground('test/model', file);
      const errors: Error[] = [];
      modelManager.watchDownload(info.downloadId, undefined, error => errors.push(error));

      await device.failDownload(info.downloadId, 'Network error');

      expect(errors.map(e => e.message)).toEqual(['Network error']);
      expect(await device.readRegistry()).toEqual([]);
    });

    describe('resetMmProjForRetry', () => {
      it('makes a retried projector count again, so the model finishes as a vision model', async () => {
        const { modelManager, modelsDir } = device;
        const file = createModelFileWithMmProj({
          name: 'vision.gguf', size: 4_000_000_000, quantization: 'Q4_K_M', mmProjName: 'mmproj.gguf', mmProjSize: 500_000_000,
        });
        const info = await modelManager.downloadModelBackground('test/model', file);
        modelManager.watchDownload(info.downloadId);
        const sidecar = device.nativeRows().find(r => r.downloadId !== info.downloadId)!;

        // The projector fails first; the download now plans to finish text-only.
        await device.failDownload(sidecar.downloadId, 'connection reset');
        // The user retries the projector: the native row runs again under the same id.
        device.boundary.download!.seedActive({ ...sidecar, status: 'running' });
        modelManager.resetMmProjForRetry(info.downloadId);
        const done: DownloadedModel[] = [];
        modelManager.watchDownload(info.downloadId, model => done.push(model));

        // The main finishing alone no longer finalizes: it waits for the retried projector.
        await device.finishDownload(info.downloadId, 4_000_000_000);
        expect(done).toEqual([]);

        await device.finishDownload(sidecar.downloadId, 500_000_000);
        expect(done).toEqual([expect.objectContaining({ isVisionModel: true, mmProjPath: `${modelsDir}/vision-mmproj.gguf` })]);
      });

      it('leaves a text-only download alone: it still finalizes when the main file finishes', async () => {
        const { modelManager } = device;
        const info = await modelManager.downloadModelBackground('test/model', createModelFile({ name: 'model.gguf', size: 4_000_000_000 }));
        const done: DownloadedModel[] = [];
        modelManager.watchDownload(info.downloadId, model => done.push(model));

        modelManager.resetMmProjForRetry(info.downloadId);
        modelManager.resetMmProjForRetry('unknown-download');
        await device.finishDownload(info.downloadId, 4_000_000_000);

        expect(done).toEqual([expect.objectContaining({ id: 'test/model/model.gguf', isVisionModel: false })]);
      });
    });

    describe('syncBackgroundDownloads (downloads that ended while the app was closed)', () => {
      const persisted = (fileName: string, modelId: string, extra: Record<string, unknown> = {}) => ({
        modelId, fileName, quantization: 'Q4_K_M', author: 'test', totalBytes: 4_000_000_000, ...extra,
      });

      it('moves a completed download into the models folder and registers it', async () => {
        const { modelManager, modelsDir } = device;
        device.seedFinishedNativeRow({ downloadId: 'dl-1', fileName: 'model.gguf', modelId: 'test/model', sizeBytes: 4_000_000_000 });
        const cleared: string[] = [];

        const result = await modelManager.syncBackgroundDownloads(
          { 'dl-1': persisted('model.gguf', 'test/model') },
          id => cleared.push(id),
        );

        expect(result).toEqual([expect.objectContaining({ id: 'test/model/model.gguf', fileSize: 4_000_000_000 })]);
        expect(cleared).toEqual(['dl-1']);
        expect(await device.fs.exists(`${modelsDir}/model.gguf`)).toBe(true);
        expect(await device.readRegistry()).toEqual([expect.objectContaining({ id: 'test/model/model.gguf' })]);
      });

      it('clears a failed download and cancels its projector', async () => {
        device.seedFinishedNativeRow({ downloadId: 'dl-2', fileName: 'failed.gguf', modelId: 'test/failed', sizeBytes: 4000, status: 'failed' });
        device.seedFinishedNativeRow({ downloadId: 'dl-3', fileName: 'failed-mmproj.gguf', modelId: 'test/failed', sizeBytes: 400, status: 'running' });
        const cleared: string[] = [];

        await device.modelManager.syncBackgroundDownloads(
          { 'dl-2': persisted('failed.gguf', 'test/failed', { mmProjDownloadId: 'dl-3' }) },
          id => cleared.push(id),
        );
        await device.settle();

        expect(cleared).toEqual(['dl-2']);
        expect(device.nativeRows().map(r => r.downloadId)).not.toContain('dl-3');
        expect(await device.readRegistry()).toEqual([]);
      });

      it('skips a download it has no metadata for, and leaves a running one alone', async () => {
        device.seedFinishedNativeRow({ downloadId: 'dl-9', fileName: 'unknown.gguf', modelId: 'unknown', sizeBytes: 4000 });
        device.seedFinishedNativeRow({ downloadId: 'dl-4', fileName: 'running.gguf', modelId: 'test/running', sizeBytes: 4000, status: 'running' });
        const cleared: string[] = [];

        const result = await device.modelManager.syncBackgroundDownloads(
          { 'dl-4': persisted('running.gguf', 'test/running') },
          id => cleared.push(id),
        );

        expect(result).toEqual([]);
        expect(cleared).toEqual([]);
        expect(await device.readRegistry()).toEqual([]);
      });
    });

    it('repairMmProj fetches the missing projector with live progress, then links it to the model', async () => {
      const { modelManager, modelsDir } = device;
      const file = createModelFileWithMmProj({ name: 'vision-model.gguf', mmProjName: 'vision-model-mmproj.gguf', mmProjSize: 300_000_000 });
      // The model was installed through the app's download path, but its projector failed: it is
      // registered text-only.
      const { textProvider } = require('../../../../src/services/modelDownloadService/providers/textProvider');
      await textProvider.start({ modelType: 'text', modelId: 'test/model', file });
      await device.settle();
      const main = device.nativeRows().find(r => r.fileName === 'vision-model.gguf')!;
      const firstSidecar = device.nativeRows().find(r => r.downloadId !== main.downloadId)!;
      await device.failDownload(firstSidecar.downloadId, 'connection reset');
      await device.finishDownload(main.downloadId, 4_000_000_000);
      const [textOnly] = await device.readRegistry();
      expect(textOnly).toEqual(expect.objectContaining({ isVisionModel: false, mmProjFileName: 'vision-model-mmproj.gguf' }));
      expect(textOnly).not.toHaveProperty('mmProjPath');

      const { useDownloadStore } = require('../../../../src/stores/downloadStore');
      const ids: string[] = [];
      const repair = modelManager.repairMmProj('test/model', file, { onDownloadIdReady: id => ids.push(id) });
      await device.settle();

      // While running: the download id is handed out and the model's progress row is live.
      expect(ids).toHaveLength(1);
      expect(useDownloadStore.getState().downloads['test/model/vision-model.gguf']).toEqual(
        expect.objectContaining({ downloadId: ids[0], status: 'running' }),
      );

      await device.finishDownload(ids[0], 300_000_000);
      await repair;

      const [model] = await device.readRegistry();
      expect(model).toEqual(expect.objectContaining({
        isVisionModel: true, mmProjPath: `${modelsDir}/vision-model-mmproj.gguf`, mmProjFileSize: 300_000_000,
      }));
      expect(useDownloadStore.getState().downloads['test/model/vision-model.gguf']).toBeUndefined();
    });

    it('lists the native active downloads', async () => {
      device.boundary.download!.seedActive({
        downloadId: 'dl-7', fileName: 'model.gguf', modelId: 'test', status: 'running', bytesDownloaded: 100, totalBytes: 1000, createdAt: 5,
      });

      const result = await device.modelManager.getActiveBackgroundDownloads();

      expect(result).toEqual([
        expect.objectContaining({ downloadId: 'dl-7', fileName: 'model.gguf', status: 'running', bytesDownloaded: 100, totalBytes: 1000 }),
      ]);
    });

    it('hands progress polling to the native downloader', () => {
      const native = device.boundary.download!.module;

      device.modelManager.startBackgroundDownloadPolling();
      expect(native.startProgressPolling).toHaveBeenCalledTimes(1);
      device.modelManager.stopBackgroundDownloadPolling();
      expect(native.stopProgressPolling).toHaveBeenCalledTimes(1);
    });
  });
});
