/**
 * OuteTTSEngine download tests
 *
 * Covers the move onto the shared background download engine + the partial-file
 * fix: downloads route through backgroundDownloadService.downloadFileTo, and a
 * present-but-truncated file is treated as NOT downloaded (instead of being
 * reported complete as the old RNFS-exists check did).
 *
 * The phone is the boundary: the native background downloader, the disk and the host a file is
 * fetched from are fakes (harness/modelManagerDevice). The engine and the shared background
 * download service run for real on top.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';

type Engine = typeof import('../../../pro/audio/engine/tts/engines/outetts/OuteTTSEngine');
type Models = typeof import('../../../pro/audio/engine/tts/engines/outetts/models');

let device: ModelManagerDevice;
let OuteTTSEngine: Engine['OuteTTSEngine'];
let OUTETTS_BACKBONE: Models['OUTETTS_BACKBONE'];
let OUTETTS_VOCODER: Models['OUTETTS_VOCODER'];

async function phone(opts: { backgroundDownloads?: boolean } = {}) {
  device = await installModelManagerDevice(opts);
  ({ OuteTTSEngine } = require('../../../pro/audio/engine/tts/engines/outetts/OuteTTSEngine'));
  ({ OUTETTS_BACKBONE, OUTETTS_VOCODER } = require('../../../pro/audio/engine/tts/engines/outetts/models'));
}

const pathFor = (filename: string) => `${device.fs.DocumentDirectoryPath}/tts-models/${filename}`;

/** Start the download, then let the native downloader finish the one transfer it was given. */
async function downloadBackbone(sizeBytes: number) {
  // Held as an outcome from the start: the download may fail while the transfer is finishing.
  const done = new OuteTTSEngine().downloadAssets(['backbone']).then(
    () => null,
    (error: Error) => error,
  );
  await device.settle();
  const [row] = device.nativeRows();
  await device.finishDownload(row.downloadId, sizeBytes);
  return { done, row };
}

describe('OuteTTSEngine downloads', () => {
  it('treats a truncated file on disk as not-downloaded', async () => {
    await phone();
    device.fs.seedFile(pathFor(OUTETTS_BACKBONE.filename), 1000);
    device.fs.seedFile(pathFor(OUTETTS_VOCODER.filename), OUTETTS_VOCODER.sizeBytes);

    const states = await new OuteTTSEngine().checkAssetStatus();
    const backbone = states.find(s => s.asset.id === 'backbone');
    const vocoder = states.find(s => s.asset.id === 'vocoder');
    expect(backbone?.status).toBe('not-downloaded');
    expect(vocoder?.status).toBe('downloaded');
  });

  it('downloads through the shared background download engine', async () => {
    await phone();
    const { done, row } = await downloadBackbone(OUTETTS_BACKBONE.sizeBytes);
    expect(await done).toBeNull();

    expect(row.modelId).toBe('tts-outetts-backbone');
    expect((row as { url?: string }).url).toBe(OUTETTS_BACKBONE.url);
    expect(await device.fs.exists(pathFor(OUTETTS_BACKBONE.filename))).toBe(true);
    const states = await new OuteTTSEngine().checkAssetStatus();
    expect(states.find(s => s.asset.id === 'backbone')?.status).toBe('downloaded');
  });

  it('falls back to RNFS when the native downloader is unavailable', async () => {
    await phone({ backgroundDownloads: false });
    device.fs.serveRemoteFile(OUTETTS_BACKBONE.url, { body: 'gguf', reportedSize: OUTETTS_BACKBONE.sizeBytes });

    await new OuteTTSEngine().downloadAssets(['backbone']);

    expect(device.nativeRows()).toEqual([]);
    const states = await new OuteTTSEngine().checkAssetStatus();
    expect(states.find(s => s.asset.id === 'backbone')?.status).toBe('downloaded');
  });

  it('rejects and cleans up when the downloaded file is incomplete', async () => {
    await phone();
    const { done } = await downloadBackbone(1000);

    expect((await done)?.message).toMatch(/incomplete/i);
    expect(await device.fs.exists(pathFor(OUTETTS_BACKBONE.filename))).toBe(false);
  });
});
