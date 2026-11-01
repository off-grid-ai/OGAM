/**
 * startModelDownload — the single download action shared by the Models screen and
 * the onboarding ModelDownloadScreen. Verifies the duplicate guard, the queued row published up front,
 * register+clear on completion, and the error paths (failed status + onError).
 *
 * The phone is the boundary: the native background downloader (it can refuse a start, report a failure,
 * or finish a transfer), the disk and storage (harness/modelManagerDevice). startModelDownload, modelManager,
 * the background download service and the stores run for real.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';

const MODEL_ID = 'author/model';
const KEY = 'author/model/model.gguf';
const SIZE = 1_000_000;

let device: ModelManagerDevice;
let startModelDownload: typeof import('../../../src/services/startModelDownload')['startModelDownload'];
let row: () => Record<string, any> | undefined;

beforeEach(async () => {
  device = await installModelManagerDevice();
  ({ startModelDownload } = require('../../../src/services/startModelDownload'));
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  row = () => useDownloadStore.getState().downloads[KEY];
});

const file = () => createModelFile({ name: 'model.gguf', size: SIZE });
const registered = () => require('../../../src/stores').useAppStore.getState().downloadedModels as Array<{ id: string }>;

describe('startModelDownload', () => {
  it('starts the download; completion registers the model, clears the row and calls onRegistered', async () => {
    const onRegistered = jest.fn();
    await startModelDownload(MODEL_ID, file(), { onRegistered });
    await device.settle();
    const [native] = device.nativeRows();
    expect(native).toEqual(expect.objectContaining({ fileName: 'model.gguf', modelId: MODEL_ID }));

    await device.finishDownload(native.downloadId, SIZE);
    expect(registered().map(m => m.id)).toContain(KEY);
    expect(row()).toBeUndefined();
    expect(onRegistered).toHaveBeenCalledWith(expect.objectContaining({ id: KEY }));
  });

  it('is a no-op when a download is already active (duplicate guard)', async () => {
    await startModelDownload(MODEL_ID, file(), {});
    await device.settle();
    await startModelDownload(MODEL_ID, file(), {});
    await device.settle();
    expect(device.nativeRows()).toHaveLength(1);
  });

  it('surfaces a start failure via onError and fails the queued placeholder row', async () => {
    // The phone refuses to start the transfer.
    device.boundary.download!.module.startDownload.mockRejectedValueOnce(new Error('boom'));
    const onError = jest.fn();
    await startModelDownload(MODEL_ID, file(), { onError });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(row()).toEqual(expect.objectContaining({ status: 'failed', errorMessage: 'boom' }));
  });

  it('swallows a cancellation of a still-queued start and removes the placeholder row', async () => {
    // Three other downloads fill the phone's download slots, so this one waits in the queue.
    for (const n of [1, 2, 3]) await startModelDownload(`other/m${n}`, createModelFile({ name: `m${n}.gguf`, size: SIZE }), {});
    await device.settle();
    const onError = jest.fn();
    const starting = startModelDownload(MODEL_ID, file(), { onError });
    await device.settle();
    // Cancel the "Queued" row before the transfer starts, as its card's Cancel does.
    await require('../../../src/services/backgroundDownloadService').backgroundDownloadService.cancelDownload(`queued:${KEY}`);
    await starting;
    await device.settle();
    expect(onError).not.toHaveBeenCalled();
    expect(row()).toBeUndefined();
  });

  it('a cancel on the Queued row wins even when it comes before the start reaches the queue', async () => {
    for (const n of [1, 2, 3]) await startModelDownload(`other/m${n}`, createModelFile({ name: `m${n}.gguf`, size: SIZE }), {});
    await device.settle();
    const onError = jest.fn();
    let settled = false;
    const starting = startModelDownload(MODEL_ID, file(), { onError }).then(() => { settled = true; });
    // The Cancel lands at once, while the start is still checking the disk.
    await require('../../../src/services/backgroundDownloadService').backgroundDownloadService.cancelDownload(`queued:${KEY}`);
    await device.settle();
    // A slot frees later: the cancelled model still must not start.
    await device.finishDownload(device.nativeRows()[0].downloadId, SIZE);
    await device.settle();

    expect(settled).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(row()).toBeUndefined();
    expect(device.nativeRows().map(r => r.modelId)).not.toContain(MODEL_ID);
    await starting;
  });

  it('publishes a QUEUED (pending) store row up front, before the native start', async () => {
    const starting = startModelDownload(MODEL_ID, file(), {});
    // The row exists at once, so the Models/onboarding screens can show "Queued".
    expect(row()).toEqual(expect.objectContaining({ downloadId: `queued:${KEY}`, status: 'pending', modelType: 'text' }));
    await starting;
  });

  it('stores the mmproj FILENAME (not the main gguf name) on a vision queued row', async () => {
    const vision = createModelFileWithMmProj({ name: 'model.gguf', size: SIZE, mmProjName: 'model-mmproj.gguf', mmProjSize: 500 });
    const starting = startModelDownload(MODEL_ID, vision, {});
    expect(row()).toEqual(expect.objectContaining({ mmProjFileName: 'model-mmproj.gguf', mmProjFileSize: 500 }));
    await starting;
  });

  it('is a no-op on a second tap while the first is still QUEUED (dedup)', async () => {
    const first = startModelDownload(MODEL_ID, file(), {});
    const second = startModelDownload(MODEL_ID, file(), {});
    await Promise.all([first, second]);
    await device.settle();
    expect(device.nativeRows()).toHaveLength(1);
  });

  it('marks the entry failed + calls onError when the transfer fails', async () => {
    const onError = jest.fn();
    await startModelDownload(MODEL_ID, file(), { onError });
    await device.settle();
    await device.failDownload(device.nativeRows()[0].downloadId, 'net');
    expect(row()?.status).toBe('failed');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('net') }));
  });
});
