/**
 * WhisperModelDownloads: who owns a transcription model's download when deletes and new downloads overlap.
 *
 * The phone is the boundary: the native background downloader (its rows; a cancel removes one), the disk
 * and storage (harness/modelManagerDevice). The transcription downloads, the background download service and
 * the download store run for real. Ownership shows in what the phone is left with: which native transfers are
 * still running and which files are on disk.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';

let device: ModelManagerDevice;
let downloads: import('../../../src/services/whisperModelDownloads').WhisperModelDownloads;
const SIZE = 75 * 1024 * 1024;

beforeEach(async () => {
  device = await installModelManagerDevice();
  const { WhisperModelDownloads } = require('../../../src/services/whisperModelDownloads');
  downloads = new WhisperModelDownloads();
});

const path = (model: string) =>
  require('../../../src/services/whisperModelFiles').getModelPath(model) as string;
/** The native transfers running for `model`, oldest first. */
const transfers = (model: string) => device.nativeRows().filter(r => r.modelId === `whisper-${model}`);
/** A download's outcome, held from the start: null when it finished, else the error. */
const outcome = (p: Promise<unknown>) => p.then(() => null, (e: Error & { cancelled?: boolean }) => e);

describe('WhisperModelDownloads concurrent ownership', () => {
  it('cancels the deleted model without disturbing another active download', async () => {
    const tiny = outcome(downloads.downloadModel('tiny.en'));
    const base = outcome(downloads.downloadModel('base.en'));
    await device.settle();
    expect(transfers('tiny.en')).toHaveLength(1);
    expect(transfers('base.en')).toHaveLength(1);

    await downloads.deleteModel('tiny.en');
    expect(transfers('tiny.en')).toEqual([]);
    expect(transfers('base.en')).toHaveLength(1);

    await device.finishDownload(transfers('base.en')[0].downloadId, SIZE);
    expect(await base).toBeNull();
    expect((await tiny)?.cancelled).toBe(true);
    expect(await device.fs.exists(path('base.en'))).toBe(true);
  });

  it('does not let an older same-model completion erase the newer download owner', async () => {
    const first = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    const second = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    const [older, newer] = transfers('tiny.en');

    await device.finishDownload(older.downloadId, SIZE);
    expect(await first).toBeNull();

    // A delete now reaches the newer download, which still owns the model.
    await downloads.deleteModel('tiny.en');
    expect(transfers('tiny.en').map(r => r.downloadId)).not.toContain(newer.downloadId);
    expect((await second)?.cancelled).toBe(true);
  });

  it('cancels a model deleted before its native download has started', async () => {
    const downloading = outcome(downloads.downloadModel('tiny.en'));
    await downloads.deleteModel('tiny.en');
    await device.settle();

    expect((await downloading)?.cancelled).toBe(true);
    expect(transfers('tiny.en')).toEqual([]);
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    expect(Object.keys(useDownloadStore.getState().downloads)).toEqual([]);
  });

  it('keeps replacement ownership when an older delete settles', async () => {
    const older = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    const staleDelete = downloads.deleteModel('tiny.en');
    const replacement = outcome(downloads.downloadModel('tiny.en'));
    await staleDelete;
    await device.settle();

    expect((await older)?.cancelled).toBe(true);
    // The replacement's transfer runs on, untouched by the older delete.
    expect(transfers('tiny.en')).toHaveLength(1);

    await downloads.deleteModel('tiny.en');
    expect(transfers('tiny.en')).toEqual([]);
    expect((await replacement)?.cancelled).toBe(true);
  });

  it('does not let an older failed owner unlink a replacement file', async () => {
    const older = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    const replacement = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    const [olderTransfer, replacementTransfer] = transfers('tiny.en');

    await device.finishDownload(replacementTransfer.downloadId, SIZE);
    expect(await replacement).toBeNull();
    await device.failDownload(olderTransfer.downloadId, 'Older download failed');

    expect((await older)?.message).toBeTruthy();
    expect(await device.fs.exists(path('tiny.en'))).toBe(true);
  });

  it('removes a failed partial file when the failing download still owns it', async () => {
    const downloading = outcome(downloads.downloadModel('tiny.en'));
    await device.settle();
    // Part of the file reached the disk before the transfer failed.
    device.fs.seedFile(path('tiny.en'), 1024);
    await device.failDownload(transfers('tiny.en')[0].downloadId, 'Current download failed');

    expect((await downloading)?.message).toBeTruthy();
    expect(await device.fs.exists(path('tiny.en'))).toBe(false);
  });
});
