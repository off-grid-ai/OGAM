/**
 * The Models tab's downloads badge and the Download Manager's Active list answer "how many downloads
 * need you" by ONE rule (outstandingDownloadItems), so the badge equals the number of rows listed.
 *
 * Device (2026-11): the badge said "4 in progress" over a list of 2 (1 paused, 1 failed). The badge
 * counted every active/failed/paused store row; the list drops a row whose model is already
 * downloaded. A stale failed row for an installed model counted on the badge and listed nowhere.
 *
 * Real stack: only the device boundary is faked (disk, native downloader, HF API). Downloads arrive
 * through the download service and the native downloader; both screens' hooks run for real, under the
 * app root's download listeners. Outcomes are the badge number and the listed rows.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { requireRTL } from '../../harness/nativeBoundary';
import { serveHfModelApi, type HfModelApiServer } from '../../harness/hfModelApiServer';
import { createModelFile } from '../../utils/factories';
import type { ModelFile } from '../../../src/types';
import type { UseDownloadManagerResult } from '../../../src/screens/DownloadManagerScreen/useDownloadManager';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SIZE = 400_000_000;

let device: ModelManagerDevice;
let server: HfModelApiServer;
let rtl: ReturnType<typeof requireRTL>;
let unmount: (() => void) | undefined;

const hfFile = (repo: string, name: string): ModelFile =>
  createModelFile({ name, size: SIZE, downloadUrl: `https://huggingface.co/${repo}/resolve/${SHA}/${name}` });

beforeEach(async () => {
  device = await installModelManagerDevice({ platform: 'android' });
  server = serveHfModelApi();
  rtl = requireRTL();
  require('../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  server?.restore();
});

const service = () => require('../../../src/services/modelDownloadService').modelDownloadService;
const settle = () => rtl.act(async () => { await device.settle(); });

async function start(repo: string, file: ModelFile): Promise<string> {
  await rtl.act(async () => { await service().start({ modelType: 'text', modelId: repo, file }); });
  const row = device.nativeRows().find(r => r.fileName === file.name && r.status === 'running');
  if (!row) throw new Error(`${file.name} did not start`);
  return row.downloadId;
}

/** Download a model to the end, then leave a stale FAILED store row for that same model — what a
 *  re-start of an installed model (or a stale restore) leaves behind. */
async function installWithStaleFailedRow(repo: string, file: ModelFile) {
  const downloadId = await start(repo, file);
  await rtl.act(async () => { await device.finishDownload(downloadId, file.size); await device.settle(); });
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { makeModelKey } = require('../../../src/utils/modelKey');
  const modelKey = makeModelKey(repo, file.name);
  await rtl.act(async () => {
    useDownloadStore.getState().add({
      modelKey, downloadId: 'stale-dl', modelId: repo, fileName: file.name, quantization: 'Q4_K_M',
      modelType: 'text', status: 'failed', bytesDownloaded: 0, totalBytes: SIZE,
      combinedTotalBytes: SIZE, progress: 0, errorMessage: 'Network lost', createdAt: Date.now(),
    });
  });
  return modelKey;
}

/** Both screens' hooks, mounted as the app mounts them. */
async function mountBoth() {
  const { useModelsScreen } = require('../../../src/screens/ModelsScreen/useModelsScreen');
  const { useDownloadManager } = require('../../../src/screens/DownloadManagerScreen/useDownloadManager');
  const { useDownloadListeners } = require('../../../src/hooks/useDownloads');
  const view = rtl.renderHook((): { badge: number; list: UseDownloadManagerResult } => {
    useDownloadListeners();
    return { badge: useModelsScreen().downloadBadgeCount as number, list: useDownloadManager() };
  });
  unmount = view.unmount;
  await settle();
  return view.result;
}

describe('downloads badge equals the Download Manager list', () => {
  it('counts 0 for a stale failed row whose model is already downloaded', async () => {
    const modelKey = await installWithStaleFailedRow('org/installed', hfFile('org/installed', 'installed-Q4_K_M.gguf'));
    const result = await mountBoth();

    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    expect(useDownloadStore.getState().downloads[modelKey]?.status).toBe('failed');
    expect(result.current.list.activeItems).toHaveLength(0);
    expect(result.current.badge).toBe(0);
  });

  it('counts the paused and failed downloads the list shows, and not the stale row', async () => {
    await installWithStaleFailedRow('org/installed', hfFile('org/installed', 'installed-Q4_K_M.gguf'));
    const pausedFile = hfFile('org/paused', 'paused-Q4_K_M.gguf');
    const failedFile = hfFile('org/failed', 'failed-Q4_K_M.gguf');
    await start('org/paused', pausedFile);
    const failedId = await start('org/failed', failedFile);
    const result = await mountBoth();

    const paused = result.current.list.activeItems.find(i => i.fileName === pausedFile.name)!;
    await rtl.act(async () => { await result.current.list.handlePauseDownload(paused); await device.settle(); });
    await rtl.act(async () => { await device.failDownload(failedId, 'Network lost'); await device.settle(); });

    const statuses = result.current.list.activeItems.map(i => [i.fileName, i.status]).sort();
    expect(statuses).toEqual([[failedFile.name, 'failed'], [pausedFile.name, 'paused']]);
    expect(result.current.badge).toBe(result.current.list.activeItems.length);
    expect(result.current.badge).toBe(2);
  });

  it('counts 0 for a stale failed row of a transcription model already on the phone', async () => {
    const { getModelsDir } = require('../../../src/services/whisperModelFiles');
    const { useWhisperStore } = require('../../../src/stores');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    device.fs.seedFile(`${getModelsDir()}/ggml-base.en.bin`, 142 * 1024 * 1024);
    await rtl.act(async () => {
      await useWhisperStore.getState().refreshPresentModels();
      useDownloadStore.getState().add({
        modelKey: 'whisper-base.en', downloadId: 'stale-stt', modelId: 'whisper-base.en', fileName: 'ggml-base.en.bin',
        quantization: '', modelType: 'stt', status: 'failed', bytesDownloaded: 0, totalBytes: SIZE,
        combinedTotalBytes: SIZE, progress: 0, errorMessage: 'Network lost', createdAt: Date.now(),
      });
    });
    const result = await mountBoth();

    expect(useWhisperStore.getState().presentModelIds).toEqual(['base.en']);
    expect(result.current.list.completedItems.some(i => i.modelType === 'stt' && i.modelId === 'base.en')).toBe(true);
    expect(result.current.list.activeItems).toHaveLength(0);
    expect(result.current.badge).toBe(0);
  });
});
