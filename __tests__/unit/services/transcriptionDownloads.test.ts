/**
 * Transcription model downloads, on the phone.
 *
 * A transcription model whose download fails mid-session stays in the Download Manager as failed, with
 * Retry, the same as a failed row restored after a relaunch. It used to vanish: the download's cleanup
 * removed its row whatever the outcome, so there was nothing left to retry.
 *
 * The phone is the boundary: the native background downloader (the transfer fails or finishes there),
 * the disk and storage (harness/modelManagerDevice). The transcription download service, the download
 * service with its providers, and the store run for real.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';

const MODEL = 'tiny.en';
const ID = `stt:${MODEL}`;
const SIZE = 75 * 1024 * 1024;

let device: ModelManagerDevice;
type Row = { id: string; status: string; error?: string; capabilities: { retry: boolean } };
let downloads: { list(): Promise<Row[]>; retry(id: string): Promise<void> };

beforeEach(async () => {
  device = await installModelManagerDevice();
  // App boot registers the core download providers with the one download service.
  require('../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
  ({ modelDownloadService: downloads } = require('../../../src/services/modelDownloadService'));
});

/** The transcription model's row in the Download Manager. */
async function row() {
  return (await downloads.list()).find(d => d.id === ID);
}

/** The native transfer the app started for this model. */
async function transfer() {
  await device.settle();
  const [native] = device.nativeRows().filter(r => r.modelId === `whisper-${MODEL}`);
  return native;
}

it('keeps a failed transcription download with Retry, and Retry completes it', async () => {
  const { whisperService } = require('../../../src/services/whisperService');
  const first = whisperService.downloadModel(MODEL).then(
    () => null,
    (error: Error) => error,
  );
  await device.failDownload((await transfer()).downloadId, 'connection reset');

  expect((await first)?.message).toBeTruthy();
  // The row stays, failed, with its reason, and offers Retry.
  expect(await row()).toEqual(
    expect.objectContaining({ status: 'error', error: 'connection reset', capabilities: expect.objectContaining({ retry: true }) }),
  );

  await downloads.retry(ID);
  await device.finishDownload((await transfer()).downloadId, SIZE);
  await device.settle();

  expect(await whisperService.isModelDownloaded(MODEL)).toBe(true);
  expect((await row())?.status).not.toBe('error');
});

it('a failed transcription download keeps its reason code on the row', async () => {
  // 0.0.122: a Whisper download failed again and again with no code ("error"), so the numbers could
  // not say why. The row now carries the native reason.
  const { whisperService } = require('../../../src/services/whisperService');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const first = whisperService.downloadModel(MODEL).catch(() => undefined);
  await device.failDownload((await transfer()).downloadId, 'The connection was lost.', 'network_lost');
  await first;

  const entry = Object.values(useDownloadStore.getState().downloads).find((e: any) => e.modelId === `whisper-${MODEL}`);
  expect(entry).toMatchObject({ status: 'failed', errorCode: 'network_lost' });
});

it('a cancelled transcription download leaves no row', async () => {
  const { whisperService } = require('../../../src/services/whisperService');
  const first = whisperService.downloadModel(MODEL).catch(() => undefined);
  await transfer();
  await whisperService.deleteModel(MODEL);
  await first;
  await device.settle();
  expect(await row()).toBeUndefined();
});

describe('downloading a transcription model', () => {
  const path = () =>
    require('../../../src/services/whisperService').whisperService.getModelPath(MODEL) as string;

  it('refuses a model it does not know', async () => {
    const { whisperService } = require('../../../src/services/whisperService');
    await expect(whisperService.downloadModel('nonexistent')).rejects.toThrow(/Unknown model/);
  });

  it('returns the model already on the phone without a transfer', async () => {
    const { whisperService } = require('../../../src/services/whisperService');
    device.fs.seedFile(path(), SIZE);
    expect(await whisperService.downloadModel(MODEL)).toBe(path());
    expect(device.nativeRows()).toEqual([]);
  });

  it('downloads through the native downloader, shows live progress, and leaves the list when done', async () => {
    const { whisperService } = require('../../../src/services/whisperService');
    const progress: number[] = [];
    const done = whisperService.downloadModel(MODEL, (p: number) => progress.push(p));
    const native = await transfer();
    expect(native).toEqual(expect.objectContaining({ modelType: 'stt', url: expect.stringContaining('ggml-tiny.en.bin') }));
    expect((await row())?.status).toBeDefined();

    await device.reportProgress(native.downloadId, SIZE / 2, SIZE);
    expect(progress.at(-1)).toBeCloseTo(0.5);

    await device.finishDownload(native.downloadId, SIZE);
    expect(await done).toBe(path());
    expect(await device.fs.exists(path())).toBe(true);
    await device.settle();
    // A finished download leaves the in-flight list; the model now shows as downloaded.
    expect((await row())?.status).not.toBe('downloading');
  });

  it('removes the partial file and rethrows when the transfer fails', async () => {
    const { whisperService } = require('../../../src/services/whisperService');
    const done = whisperService.downloadModel(MODEL).then(() => null, (e: Error) => e);
    const native = await transfer();
    await device.reportProgress(native.downloadId, SIZE / 3, SIZE);
    // Part of the file reached the disk before the transfer failed.
    device.fs.seedFile(path(), 1024);
    await device.failDownload(native.downloadId, 'Network error');
    expect((await done)?.message).toBeTruthy();
    expect(await device.fs.exists(path())).toBe(false);
  });
});
