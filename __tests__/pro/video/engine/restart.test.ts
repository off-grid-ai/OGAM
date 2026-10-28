/**
 * Video on the phone after the app is closed and opened again, below the UI.
 *
 * SPEC (OGAM): a clip still being made when the app opens again carries on and lands in its chat,
 * without a second clip being started. A clip the phone stopped with the app is shown as interrupted,
 * and Retry makes it. A video model download that was running carries on from where it was: files
 * already on the phone are kept and no file is downloaded twice.
 *
 * Real: the video seam, the video services, the download provider, the stores and their saved state,
 * Pro activation (which recovers work on launch). Device boundary only: the native video engine (whose
 * worker Android keeps alive across a restart), the disk, the RAM sensor, the native downloads.
 */
import { bootPhoneVideo, closePhoneVideo, until, WAN, type PhoneVideo } from '../../../harness/phoneVideoServices';
import { phoneDownloads } from '../../../harness/nativeVideoEngine';

let phone: PhoneVideo | undefined;

afterEach(async () => {
  await closePhoneVideo();
  phone = undefined;
});

/** A clip held on its first step, in a new chat. */
async function clipInFlight(prompt: string) {
  const first = await bootPhoneVideo();
  await first.installPack();
  const chat = first.newChat();
  first.engine.hold();
  first.seam.generate({ prompt, conversationId: chat }).catch(() => undefined);
  await until(() => first.service.getState().progress?.step === 1, 10_000, 'the first step');
  expect(first.app().generatedVideos).toHaveLength(0);
  return { first, chat };
}

it('a clip the native worker kept making while the app was closed lands in its chat, once', async () => {
  const { first, chat } = await clipInFlight('a hummingbird over a red flower');

  // Closed and opened again; Android kept the video worker running.
  phone = await bootPhoneVideo({ relaunch: true, keptPack: WAN, carryOver: first.engine });
  await until(() => phone!.service.getState().phase === 'running', 10_000, 'the clip to be picked up');
  expect(phone.seam.isBusy()).toBe(true);
  phone.engine.release();

  await until(() => phone!.service.getState().phase === 'succeeded', 15_000, 'the clip to finish');
  const [clip] = phone.app().generatedVideos;
  expect(clip.prompt).toBe('a hummingbird over a red flower');
  expect(await phone.onDisk(clip.videoPath)).toBe(true);
  expect(phone.messages(chat).filter(message => message.attachments?.some(item => item.id === clip.id))).toHaveLength(1);
  // The same job, not a second clip.
  expect(phone.engine.generations).toHaveLength(1);
  expect(phone.failure()).toBeUndefined();
});

it('a clip the phone stopped with the app is shown interrupted, and Retry makes it', async () => {
  await clipInFlight('a lantern on a dark river');

  // Closed and opened again; the OS ended the video worker with the app.
  phone = await bootPhoneVideo({ relaunch: true, keptPack: WAN });
  await until(() => phone!.service.getState().phase === 'failed', 10_000, 'the interrupted clip');
  expect(phone.service.getState().error).toMatch(/interrupted/i);
  expect(phone.seam.isBusy()).toBe(false);
  const card = phone.failure()!;
  expect(card.onRetry).toEqual(expect.any(Function));

  card.onRetry!();
  await until(() => phone!.service.getState().phase === 'succeeded', 15_000, 'the retried clip');
  const [clip] = phone.app().generatedVideos;
  expect(clip.prompt).toBe('a lantern on a dark river');
  expect(await phone.onDisk(clip.videoPath)).toBe(true);
  expect(phone.engine.generations).toHaveLength(1);
});

it('a video model download carries on after a restart: kept files stay, none is downloaded twice', async () => {
  const first = await bootPhoneVideo();
  const { CATALOG } = require('@offgrid/models');
  const model = CATALOG.find((entry: { id: string }) => entry.id === WAN);
  const { videoModelDirectory } = require('../../../../src/services/videoModelFiles');
  const directory = videoModelDirectory(WAN);
  first.provider.start!({ modelType: 'video', model } as never).catch(() => undefined);

  // The first file lands; the second is downloading natively when the app closes.
  const downloads = phoneDownloads(first.boundary, async work => work());
  await until(async () => (await downloads.finishRunning()) === 1, 10_000, 'the first file');
  await until(
    () => first.boundary.download!.active().some(row => row.status === 'running' && row.modelKey?.endsWith(model.files[1].name)),
    10_000,
    'the second file to start',
  );
  const startedBefore = first.boundary.download!.module.startDownload.mock.calls.length;
  expect(first.app().downloadedVideoModels).toHaveLength(0);

  // Android keeps the native download still running; the disk keeps the file that finished.
  phone = await bootPhoneVideo({
    relaunch: true,
    keptFiles: [{ path: `${directory}/${model.files[0].name}`, size: model.files[0].sizeBytes }],
    nativeRows: first.boundary.download!.active().filter(row => row.modelKey?.endsWith(model.files[1].name)),
  });
  // The pack is downloading again (following the native download) before the network finishes it.
  const { useDownloadStore } = require('../../../../src/stores/downloadStore');
  await until(() => useDownloadStore.getState().downloads[`video:${WAN}`]?.status === 'running', 10_000, 'the pack to carry on');
  const after = phoneDownloads(phone.boundary, async work => work());
  let finished = 0;
  await until(async () => {
    finished += await after.finishRunning();
    return phone!.app().downloadedVideoModels.some(item => item.id === WAN);
  }, 15_000, 'the pack to install');

  for (const file of model.files) {
    const stat = await require('react-native-fs').stat(`${directory}/${file.name}`);
    expect(Number(stat.size)).toBe(file.sizeBytes);
  }
  // Every file was asked of the network once across both launches.
  const startedAfter = phone.boundary.download!.module.startDownload.mock.calls.length;
  expect(startedBefore + startedAfter).toBe(model.files.length);
  expect(finished).toBe(model.files.length - 1);
});
