/**
 * A video pack that shares a file with one already on the phone.
 *
 * SPEC (OGAM user's view): every Wan pack uses the same text encoder (3.7 GB). With Wan 2.1 on the phone,
 * getting Wan 2.2 Light offers only what is missing, and the download copies the encoder from Wan 2.1
 * instead of fetching it again. Both models keep their own copy, so removing one never breaks the other.
 *
 * The real video download service runs. Device boundaries only: the disk and the background downloader.
 */
import { bootPhoneVideo, closePhoneVideo, until, WAN } from '../../../harness/phoneVideoServices';
import { phoneDownloads } from '../../../harness/nativeVideoEngine';

afterEach(() => closePhoneVideo());

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const ENCODER = 'umt5-xxl-encoder-Q4_K_M.gguf';

it('offers and fetches only the files the phone does not have: the shared encoder is copied', async () => {
  const phone = await bootPhoneVideo();
  await phone.installPack(WAN);
  // Read after boot: the harness loads the app's modules fresh.
  const { CATALOG } = require('@offgrid/models');
  const light = CATALOG.find((model: { id: string }) => model.id === LIGHT);
  const encoder = light.files.find((file: { name: string }) => file.name === ENCODER);
  const whole = light.files.reduce((sum: number, file: { sizeBytes?: number }) => sum + (file.sizeBytes ?? 0), 0);
  const { bytesToFetch } = require('../../../../pro/video/videoProvider');

  // The offer counts what is missing, not the whole pack.
  expect(bytesToFetch(light)).toBe(whole - encoder.sizeBytes);

  // The download fetches every file but the encoder, and the encoder lands beside them all the same.
  // A finished download holds the real file: the disk reports each Light file's published checksum.
  const fs = phone.boundary.fs!.module;
  const realHash = fs.hash.getMockImplementation()!;
  fs.hash.mockImplementation(async (path: string, algorithm: string) => {
    const file = light.files.find((item: { name: string }) => path.endsWith(`/${item.name}`));
    return file?.sha256 ?? realHash(path, algorithm);
  });
  // Wan 2.1's own downloads finished; the fake downloader leaves their rows running, so close them as Android does.
  for (const row of phone.boundary.download!.active()) row.status = 'completed';
  const before = phone.boundary.download!.active().length;
  const downloads = phoneDownloads(phone.boundary, async work => work());
  const started = phone.provider.start!({ modelType: 'video', model: light });
  let finished = 0;
  await until(async () => {
    finished += await downloads.finishRunning();
    return finished === light.files.length - 1;
  }, 15_000, 'the missing files to download');
  await started;
  await until(() => phone.app().downloadedVideoModels.some(item => item.id === LIGHT), 10_000, 'Wan 2.2 Light to install');
  const fetched = phone.boundary.download!.active().slice(before).map(row => row.fileName);
  expect(fetched.some(name => name?.endsWith(ENCODER))).toBe(false);
  const { videoModelDirectory } = require('../../../../src/services/videoModelFiles');
  expect(await phone.onDisk(`${videoModelDirectory(LIGHT)}/${ENCODER}`)).toBe(true);
  expect(await phone.onDisk(`${videoModelDirectory(WAN)}/${ENCODER}`)).toBe(true);
}, 60_000);
