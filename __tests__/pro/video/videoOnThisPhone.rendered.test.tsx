/**
 * A video model downloaded to the phone, and clips made on the phone with it.
 *
 * SPEC (OGAM user's view): in Models › Video I find a video model, see its size and the memory it
 * suggests, and download it: every file of it, with progress, until the card says it is on the
 * phone. I pick it on Home and describe a clip in a chat in video mode: the clip is made on this
 * phone, shows its progress while it runs, and lands as a clip card. I can stop a clip midway. A whole film
 * is made here too, shot by shot, then joined. A download can be paused, resumed or cancelled, and
 * an installed model deleted; a download the network drops says so and can be retried or removed, and one cut off by the app
 * closing says so and can be retried. A clip still being made when the app opens again carries on; one the phone stopped with the
 * app says so and Retry makes it again; one the worker could not finish shows why. While a clip is
 * made, the engine's first frame shows; a phone short of free
 * memory says so before it starts and can run it anyway.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the
 * native background downloads, the phone's video engine and film composer (nativeVideoEngine).
 */
jest.unmock('@react-navigation/native');

import { GB } from '../../harness/nativeBoundary';
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { installNativeVideoEngine, phoneDownloads, type NativeVideoEngine, type PhoneDownloads } from '../../harness/nativeVideoEngine';

/** Wan 2.1 (1.3B), FP16: the catalog build Android runs whose files carry no published checksum. */
const MODEL = { id: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', name: 'Wan 2.1 (1.3B), FP16', files: 3 };

let app: AnalyticsApp | undefined;

/** The OS dialog (Alert.alert): the app uses its own sheet instead, so a test asserts none is raised. */
interface OsDialog { title: string; buttons: Array<{ text?: string; onPress?: () => void }> }
function watchDialogs(): { last: () => OsDialog | null } {
  let dialog: OsDialog | null = null;
  require('react-native').Alert.alert = (title: string, _message?: string, buttons?: OsDialog['buttons']) => {
    dialog = { title, buttons: buttons ?? [] };
  };
  return { last: () => dialog };
}

afterEach(() => {
  // What ending Pro does: stop every render and the charger watch, so no timer outlives the test.
  if (app) require('../../../pro/video/studio/filmRenderer').stopAllRenders();
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

interface PhoneVideoApp extends AnalyticsApp {
  engine: NativeVideoEngine;
  downloads: PhoneDownloads;
}

/** By default a phone with room for a 6.3 GB video model: 24 GB, 20 GB of it free (the RAM sensor). */
async function launch(
  options: {
    ram?: { totalBytes: number; availBytes: number };
    relaunch?: boolean;
    /** The video model a finished download left on the phone's disk, which a relaunch keeps. */
    installedModel?: boolean;
    /** Files the previous launch left on its disk (path and size), which a relaunch keeps. */
    keptFiles?: Array<{ path: string; size: number }>;
    /** Native downloads still running across the restart (Android keeps them), as the native layer lists them. */
    nativeRows?: Array<Record<string, unknown>>;
    carryOver?: NativeVideoEngine;
  } = {},
): Promise<PhoneVideoApp> {
  let engine!: NativeVideoEngine;
  const ram = options.ram ?? { totalBytes: 24 * GB, availBytes: 20 * GB };
  app = await launchApp({ release: false, download: true, relaunch: options.relaunch, beforeApp: boundary => {
    boundary.setRam({ platform: 'android', ...ram });
    // A relaunch keeps the phone's disk; this harness's disk is new per launch, so the video model a
    // finished download left there is put back, file by file, at its real size.
    if (options.installedModel) {
      const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
      const entry = require('@offgrid/models').CATALOG.find((model: { id: string }) => model.id === MODEL.id);
      for (const file of entry.files) boundary.fs!.seedFile(`${videoModelDirectory(MODEL.id)}/${file.name}`, file.sizeBytes);
    }
    for (const file of options.keptFiles ?? []) boundary.fs!.seedFile(file.path, file.size);
    for (const row of options.nativeRows ?? []) boundary.download!.seedActive(row as never);
    engine = installNativeVideoEngine(boundary, options.carryOver);
  } });
  if (options.relaunch) await app.view.findByTestId('home-screen', {}, { timeout: 10_000 });
  else await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  return { ...app, engine, downloads: phoneDownloads(app.boundary, app.rtl.act) };
}

/** On the Chats list, the one chat there: it shows its title, and opens. */
async function openOnlyChat(current: { view: AnalyticsApp['view']; rtl: AnalyticsApp['rtl'] }, title: string): Promise<void> {
  const { view, rtl } = current;
  const row = await view.findByTestId('conversation-item-0', {}, { timeout: 10_000 });
  expect(view.queryByTestId('conversation-item-1')).toBeNull();
  expect(rtl.within(row).getByText(title)).toBeTruthy();
  rtl.fireEvent.press(row);
}

/** Models tab › Video › Download, then every file of the pack finishes. */
async function downloadVideoModel(current: PhoneVideoApp): Promise<void> {
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  let finished = 0;
  await rtl.waitFor(async () => {
    finished += await current.downloads.finishRunning();
    expect(finished).toBe(MODEL.files);
  }, { timeout: 15_000 });
  await rtl.waitFor(() => expect(view.queryByLabelText(`Download ${MODEL.name}`)).toBeNull());
  await rtl.waitFor(() => expect(view.getAllByLabelText('Delete model').length).toBeGreaterThan(0), { timeout: 10_000 });
}

/** Home's video summary › the downloaded model, then a new chat in video mode, and Send. */
async function describeClipOnPhone(current: PhoneVideoApp, prompt: string): Promise<void> {
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  rtl.fireEvent.press(await view.findByTestId(`video-model-row-${MODEL.id}-select`, {}, { timeout: 5000 }));
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
  rtl.fireEvent.press(view.getByTestId('send-button'));
}

it('downloads every file of a video model, then makes a clip on the phone', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await downloadVideoModel(current);
  current.engine.hold();
  await describeClipOnPhone(current, 'a hummingbird hovering over a red flower');
  // In flight on the phone: the engine's step count, and no clip card yet.
  await view.findByText(/Step 1 of \d+/, {}, { timeout: 15_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
  current.engine.release();
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  await rtl.waitFor(() => expect(view.queryByTestId('video-progress')).toBeNull());
  expect(current.engine.generations).toHaveLength(1);
  expect(current.engine.generations[0].prompt).toBe('a hummingbird hovering over a red flower');
}, 90_000);

it('stops a clip midway', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await downloadVideoModel(current);
  current.engine.hold();
  await describeClipOnPhone(current, 'waves rolling onto a sandy beach');
  await view.findByText(/Step 1 of \d+/, {}, { timeout: 15_000 });
  rtl.fireEvent.press(view.getByTestId('stop-button'));
  await rtl.waitFor(() => expect(view.queryByTestId('video-progress')).toBeNull(), { timeout: 10_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();

}, 90_000);

it('makes a whole film on the phone: each shot, then the shots joined', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await downloadVideoModel(current);
  await describeClipOnPhone(current, 'a cat chasing a butterfly through a garden');
  rtl.fireEvent.press(await view.findByTestId('video-make-story', {}, { timeout: 15_000 }));
  await view.findByText('Renders on this phone, also with the screen off.', {}, { timeout: 15_000 });
  current.engine.hold();
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  // The film is being made here: a shot in flight, nothing joined yet.
  await view.findByText(/Shot \d+ of \d+/, {}, { timeout: 15_000 });
  expect(view.getByText('You can leave the app. We send a notification when it is ready.')).toBeTruthy();
  expect(current.engine.films).toHaveLength(0);
  current.engine.release();
  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 30_000 }));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  // Every shot was made on the phone and the composer joined them into one film.
  expect(current.engine.films).toHaveLength(1);
  expect(current.engine.films[0].clips.length).toBeGreaterThan(1);
}, 90_000);

it('pauses, resumes and cancels a video model download, and deletes an installed one', async () => {
  const current = await launch();
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  rtl.fireEvent.press(await view.findByLabelText('Pause download', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByLabelText('Resume download', {}, { timeout: 10_000 }));
  rtl.fireEvent.press(await view.findByLabelText('Cancel download', {}, { timeout: 10_000 }));
  await view.findByLabelText(`Download ${MODEL.name}`, {}, { timeout: 10_000 });
  expect(view.queryByLabelText('Cancel download')).toBeNull();

  await downloadVideoModel(current);
  rtl.fireEvent.press(view.getAllByLabelText('Delete model')[0]);
  await view.findByLabelText(`Download ${MODEL.name}`, {}, { timeout: 10_000 });
}, 90_000);

/** A clip on the phone, then Make it a story: the storyboard of a film made here. */
async function phoneStoryboard(current: PhoneVideoApp, prompt: string): Promise<void> {
  const { view, rtl } = current;
  await downloadVideoModel(current);
  await describeClipOnPhone(current, prompt);
  rtl.fireEvent.press(await view.findByTestId('video-make-story', {}, { timeout: 15_000 }));
  await view.findByText('Renders on this phone, also with the screen off.', {}, { timeout: 15_000 });
}

it('a shot the engine cannot make stops the film with its reason; Try again finishes it', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await phoneStoryboard(current, 'a sailboat crossing a calm bay');
  current.engine.failNext('The video engine ran out of memory.');
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  await view.findByText('The video engine ran out of memory.', {}, { timeout: 15_000 });
  expect(view.queryByTestId('making-watch')).toBeNull();
  // The storyboard names the shot that failed.
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  await rtl.waitFor(() => expect(view.getAllByText('The video engine ran out of memory.').length).toBeGreaterThan(0));
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  rtl.fireEvent.press(await view.findByTestId('making-watch', {}, { timeout: 30_000 }));
  await view.findByTestId('video-viewer', {}, { timeout: 10_000 });
  expect(current.engine.films).toHaveLength(1);
}, 90_000);

it('Tonight on the phone, off the charger, waits for it and can be stopped', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await phoneStoryboard(current, 'fireflies over a summer field');
  expect(view.queryByText('Waiting for the charger')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('film-tonight'));
  await view.findByText('Waiting for the charger', {}, { timeout: 10_000 });
  // Nothing renders while it waits.
  expect(current.engine.generations).toHaveLength(1);
  rtl.fireEvent.press(view.getByTestId('film-cancel'));
  await view.findByTestId('film-make-real', {}, { timeout: 10_000 });
  expect(view.queryByText('Waiting for the charger')).toBeNull();
}, 90_000);

it('the film\'s card in the chat opens its storyboard as a draft, and Making while it is made', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await phoneStoryboard(current, 'a hot air balloon over the desert');
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  const card = (await view.findAllByTestId('film-card', {}, { timeout: 10_000 })).pop()!;
  rtl.fireEvent.press(rtl.within(card).getAllByRole('button')[0]);
  await view.findByTestId('film-make-real', {}, { timeout: 10_000 });
  current.engine.hold();
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await view.findByTestId('video-making', {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  const working = (await view.findAllByTestId('film-card', {}, { timeout: 10_000 })).pop()!;
  rtl.fireEvent.press(rtl.within(working).getAllByRole('button')[0]);
  await view.findByTestId('making-stop', {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByTestId('making-stop'));
  await view.findByTestId('making-retry', {}, { timeout: 10_000 });
}, 90_000);

it('a video model download the network drops says so; Retry finishes it, and Remove clears it', async () => {
  const current = await launch();
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  const dropNetwork = async () => {
    await rtl.waitFor(() => expect(boundary.download!.active().some(row => row.status === 'running')).toBe(true));
    const row = boundary.download!.active().filter(item => item.status === 'running').pop()!;
    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadError', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        status: 'failed', reason: 'Network connection lost',
      });
    });
  };

  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  await dropNetwork();
  await view.findByText(/Network connection lost/, {}, { timeout: 10_000 });
  rtl.fireEvent.press(await view.findByLabelText('Remove download', {}, { timeout: 10_000 }));
  await view.findByLabelText(`Download ${MODEL.name}`, {}, { timeout: 10_000 });
  expect(view.queryByLabelText('Retry download')).toBeNull();

  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  await dropNetwork();
  rtl.fireEvent.press(await view.findByLabelText('Retry download', {}, { timeout: 10_000 }));
  let finished = 0;
  await rtl.waitFor(async () => {
    finished += await current.downloads.finishRunning();
    expect(view.queryAllByLabelText('Delete model').length).toBeGreaterThan(0);
  }, { timeout: 15_000 });
  // The retry really downloaded the files, not just cleared the error.
  expect(finished).toBeGreaterThan(0);
  expect(view.queryByLabelText('Retry download')).toBeNull();
}, 90_000);

it('shows the engine\'s first frame while the clip is still being made', async () => {
  const current = await launch();
  const { view, rtl } = current;
  await downloadVideoModel(current);
  current.engine.showPreviews();
  current.engine.hold();
  await describeClipOnPhone(current, 'a red kite over a hillside');
  await view.findByLabelText('Live preview of the clip', {}, { timeout: 15_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
  current.engine.release();
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  await rtl.waitFor(() => expect(view.queryByLabelText('Live preview of the clip')).toBeNull());
}, 90_000);

it('on a phone short of free memory, says so before it starts, and Run anyway makes the clip', async () => {
  const current = await launch({ ram: { totalBytes: 12 * GB, availBytes: 8 * GB } });
  const { view } = current;
  await downloadVideoModel(current);
  await describeClipOnPhone(current, 'a hummingbird hovering over a red flower');
  const runAnyway = await view.findByTestId('model-failure-load-anyway-video', {}, { timeout: 15_000 });
  expect(current.engine.generations).toHaveLength(0);
  current.rtl.fireEvent.press(runAnyway);
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  expect(current.engine.generations).toHaveLength(1);
}, 90_000);

it('a video model download cut off by the app closing says so, and Retry finishes it', async () => {
  const first = await launch();
  first.rtl.fireEvent.press(await first.view.findByTestId('models-tab'));
  first.rtl.fireEvent.press(await first.view.findByTestId('video-models-tab'));
  await first.view.findByText(MODEL.name, {}, { timeout: 10_000 });
  first.rtl.fireEvent.press(first.view.getByLabelText(`Download ${MODEL.name}`));
  await first.view.findByLabelText('Cancel download', {}, { timeout: 10_000 });
  first.view.unmount();
  first.endpoint.restore();

  const current = await launch({ relaunch: true });
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(/Interrupted — app closed\./, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText('Retry download'));
  await rtl.waitFor(async () => {
    await current.downloads.finishRunning();
    expect(view.queryAllByLabelText('Delete model').length).toBeGreaterThan(0);
  }, { timeout: 15_000 });
  expect(view.queryByLabelText('Retry download')).toBeNull();
}, 90_000);

it('a video model whose files are on the phone with no record of them is offered to resume, and Resume installs it from those files', async () => {
  // What an earlier build left (seen on a OnePlus, 2026-10-28): a pack's three files complete in its folder, but
  // no installed model and no download owning them, so Models offered a 7 GB download of files already there.
  const current = await launch({ installedModel: true });
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(await view.findByLabelText('Resume download', {}, { timeout: 10_000 }));
  await rtl.waitFor(() => expect(view.queryAllByLabelText('Delete model').length).toBeGreaterThan(0), { timeout: 15_000 });
  expect(view.queryByLabelText(`Download ${MODEL.name}`)).toBeNull();
  // Every file was already on the phone: nothing was fetched.
  expect(boundary.download!.module.startDownload).not.toHaveBeenCalled();
}, 90_000);

it('a cancelled video model download leaves nothing to resume after the app opens again', async () => {
  const first = await launch();
  first.rtl.fireEvent.press(await first.view.findByTestId('models-tab'));
  first.rtl.fireEvent.press(await first.view.findByTestId('video-models-tab'));
  await first.view.findByText(MODEL.name, {}, { timeout: 10_000 });
  first.rtl.fireEvent.press(first.view.getByLabelText(`Download ${MODEL.name}`));
  // One file lands, then the person cancels; with files on the phone, Cancel asks first.
  await first.rtl.waitFor(async () => expect(await first.downloads.finishRunning()).toBe(1), { timeout: 10_000 });
  const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
  const folder = videoModelDirectory(MODEL.id);
  await first.rtl.waitFor(() => expect(first.boundary.fs!.listFiles(folder).length).toBeGreaterThan(0));
  const dialogs = watchDialogs();
  first.rtl.fireEvent.press(await first.view.findByLabelText('Cancel download', {}, { timeout: 10_000 }));
  await first.view.findByText(/^Delete the .+ downloaded so far\?$/, {}, { timeout: 10_000 });
  await first.rtl.act(() => new Promise(resolve => setTimeout(resolve, 400)));
  first.rtl.fireEvent.press(first.view.getByRole('button', { name: 'Delete' }));
  expect(dialogs.last()).toBeNull();
  await first.view.findByLabelText(`Download ${MODEL.name}`, {}, { timeout: 10_000 });
  // The phone's disk carries over to the next launch: whatever the pack's folder still holds.
  const keptFiles = first.boundary.fs!.listFiles(folder).map(path => ({ path, size: 1024 }));
  first.view.unmount();
  first.endpoint.restore();

  const current = await launch({ relaunch: true, keptFiles });
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByLabelText(`Download ${MODEL.name}`, {}, { timeout: 10_000 });
  expect(view.queryByLabelText('Resume download')).toBeNull();
}, 90_000);

it('Cancel on a download with files on the phone asks first, and Keep keeps the download and its files', async () => {
  const current = await launch();
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  await rtl.waitFor(async () => expect(await current.downloads.finishRunning()).toBe(1), { timeout: 10_000 });
  const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
  const folder = videoModelDirectory(MODEL.id);
  await rtl.waitFor(() => expect(boundary.fs!.listFiles(folder).length).toBeGreaterThan(0));
  const filesBefore = boundary.fs!.listFiles(folder);

  const dialogs = watchDialogs();
  expect(dialogs.last()).toBeNull();
  rtl.fireEvent.press(await view.findByLabelText('Cancel download', {}, { timeout: 10_000 }));
  await view.findByText(/^Delete the .+ downloaded so far\?$/, {}, { timeout: 10_000 });
  expect(dialogs.last()).toBeNull();
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 400)));
  rtl.fireEvent.press(view.getByRole('button', { name: 'Keep' }));
  await rtl.waitFor(() => expect(view.queryByText(/^Delete the .+ downloaded so far\?$/)).toBeNull());

  // The download carries on, with every file it had.
  expect(view.getByLabelText('Cancel download')).toBeTruthy();
  expect(view.queryByLabelText(`Download ${MODEL.name}`)).toBeNull();
  expect(boundary.fs!.listFiles(folder)).toEqual(filesBefore);
}, 90_000);

it('Cancel while the first file is still downloading asks first: its bytes count before any file lands', async () => {
  const current = await launch();
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  await view.findByLabelText('Cancel download', {}, { timeout: 10_000 });
  // 278 MB of the first file is in the native download's own temp file; the pack's folder is still empty.
  const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
  expect(boundary.fs!.listFiles(videoModelDirectory(MODEL.id))).toEqual([]);
  const row = boundary.download!.active().find(item => item.status === 'running')!;
  await rtl.act(async () => {
    boundary.download!.events.emit('DownloadProgress', {
      downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
      bytesDownloaded: 278 * 1024 * 1024, totalBytes: Number(row.totalBytes) || 2 * GB, status: 'running',
    });
  });

  const dialogs = watchDialogs();
  rtl.fireEvent.press(view.getByLabelText('Cancel download'));
  await view.findByText(/^Delete the .+ downloaded so far\?$/, {}, { timeout: 10_000 });
  expect(dialogs.last()).toBeNull();
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 400)));
  rtl.fireEvent.press(view.getByRole('button', { name: 'Keep' }));
  await rtl.waitFor(() => expect(view.queryByText(/^Delete the .+ downloaded so far\?$/)).toBeNull());
  expect(view.getByLabelText('Cancel download')).toBeTruthy();
}, 90_000);

it('a video model download carries on after the app restarts while Android keeps downloading, without starting a file again', async () => {
  const first = await launch();
  first.rtl.fireEvent.press(await first.view.findByTestId('models-tab'));
  first.rtl.fireEvent.press(await first.view.findByTestId('video-models-tab'));
  await first.view.findByText(MODEL.name, {}, { timeout: 10_000 });
  first.rtl.fireEvent.press(first.view.getByLabelText(`Download ${MODEL.name}`));
  // The first file lands; the second is still downloading when the app restarts.
  await first.rtl.waitFor(async () => expect(await first.downloads.finishRunning()).toBe(1), { timeout: 10_000 });
  const { videoModelDirectory } = require('../../../src/services/videoModelFiles');
  const folder = videoModelDirectory(MODEL.id);
  // The native download of a file not yet on the disk: the one still under way.
  const underWay = () => first.boundary.download!.active().filter(row =>
    row.status === 'running' &&
    !first.boundary.fs!.listFiles(folder).some(path => String(row.modelKey ?? '').endsWith(`/${path.split('/').pop()}`)));
  await first.rtl.waitFor(() => expect(underWay()).toHaveLength(1));
  const stillRunning = underWay();
  const entry = require('@offgrid/models').CATALOG.find((model: { id: string }) => model.id === MODEL.id);
  const sizeOf = (path: string) => entry.files.find((file: { name: string }) => path.endsWith(`/${file.name}`)).sizeBytes;
  const keptFiles = first.boundary.fs!.listFiles(folder).map(path => ({ path, size: sizeOf(path) }));
  first.view.unmount();
  first.endpoint.restore();

  const current = await launch({ relaunch: true, keptFiles, nativeRows: stillRunning as never });
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  // Carrying on, not stranded.
  await view.findByLabelText('Cancel download', {}, { timeout: 10_000 });
  expect(view.queryByText(/Interrupted — app closed\./)).toBeNull();

  await rtl.waitFor(async () => {
    await current.downloads.finishRunning();
    expect(view.queryAllByLabelText('Delete model').length).toBeGreaterThan(0);
  }, { timeout: 15_000 });
  // After the restart only the file never started was fetched: the running one was followed, not restarted.
  expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(MODEL.files - 2);
}, 90_000);

it('a video model too big for the space left says how much to free, and starts nothing', async () => {
  const current = await launch();
  const { view, rtl, boundary } = current;
  boundary.fs!.setFreeBytes(2 * GB);
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  await view.findByText(/^Not enough space for this video model\. Free about \d+ GB and try again\.$/, {}, { timeout: 10_000 });
  expect(boundary.download!.active()).toHaveLength(0);
  expect(view.getByLabelText(`Download ${MODEL.name}`)).toBeTruthy();
}, 90_000);

it('Retry after a dropped download keeps the files already on the phone', async () => {
  const current = await launch();
  const { view, rtl, boundary } = current;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(MODEL.name, {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByLabelText(`Download ${MODEL.name}`));
  // The first file lands; the network drops during the second.
  await rtl.waitFor(async () => expect(await current.downloads.finishRunning()).toBe(1), { timeout: 10_000 });
  await rtl.waitFor(() => expect(boundary.download!.active().filter(row => row.status === 'running')).toHaveLength(2));
  const second = boundary.download!.active().filter(row => row.status === 'running').pop()!;
  await rtl.act(async () => {
    boundary.download!.events.emit('DownloadError', {
      downloadId: second.downloadId, fileName: second.fileName, modelId: second.modelId,
      status: 'failed', reason: 'Network connection lost',
    });
  });
  const startedBefore = boundary.download!.module.startDownload.mock.calls.length;
  rtl.fireEvent.press(await view.findByLabelText('Retry download', {}, { timeout: 10_000 }));
  let finished = 0;
  await rtl.waitFor(async () => {
    finished += await current.downloads.finishRunning();
    expect(view.queryAllByLabelText('Delete model').length).toBeGreaterThan(0);
  }, { timeout: 15_000 });
  // The retry really finished downloads, and only the two files not yet on the phone were fetched again.
  expect(finished).toBeGreaterThan(0);
  expect(boundary.download!.module.startDownload.mock.calls.length - startedBefore).toBe(MODEL.files - 1);
}, 90_000);

it('a clip still being made when the app is opened again carries on and lands in its chat', async () => {
  const first = await launch();
  await downloadVideoModel(first);
  first.engine.hold();
  await describeClipOnPhone(first, 'a lantern floating down a dark river');
  await first.view.findByText(/Step 1 of \d+/, {}, { timeout: 15_000 });
  first.view.unmount();
  first.endpoint.restore();

  // The app's JS starts again; Android's video worker kept making the clip.
  const current = await launch({ relaunch: true, installedModel: true, carryOver: first.engine });
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await openOnlyChat(current, 'a lantern floating down a dark river');
  await view.findByTestId('video-progress', {}, { timeout: 10_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
  current.engine.release();
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  // The same job, found again: no second clip was started.
  expect(current.engine.generations).toHaveLength(1);
}, 90_000);

it('a clip lost with the app (the phone stopped the worker) says so, and Retry makes it again', async () => {
  const first = await launch();
  await downloadVideoModel(first);
  first.engine.hold();
  await describeClipOnPhone(first, 'a paper plane over the rooftops');
  await first.view.findByText(/Step 1 of \d+/, {}, { timeout: 15_000 });
  first.view.unmount();
  first.endpoint.restore();

  // Opened again after the phone ended the whole app, video worker included: a fresh engine knows no job.
  const current = await launch({ relaunch: true, installedModel: true });
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await openOnlyChat(current, 'a paper plane over the rooftops');
  await view.findByText(/Video generation was interrupted\. Retry to start it again\./, {}, { timeout: 10_000 });
  expect(current.engine.generations).toHaveLength(0);
  rtl.fireEvent.press(view.getByTestId('model-failure-retry-video'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  expect(current.engine.generations).toHaveLength(1);
  expect(current.engine.generations[0].prompt).toBe('a paper plane over the rooftops');
}, 90_000);

it('a clip the worker could not finish while the app was away shows the engine\'s reason', async () => {
  const first = await launch();
  await downloadVideoModel(first);
  first.engine.hold();
  await describeClipOnPhone(first, 'a whale breaching at sunset');
  await first.view.findByText(/Step 1 of \d+/, {}, { timeout: 15_000 });
  first.view.unmount();
  first.endpoint.restore();

  const current = await launch({ relaunch: true, installedModel: true, carryOver: first.engine });
  const { view, rtl } = current;
  current.engine.failNext('The video engine ran out of memory.');
  current.engine.release();
  rtl.fireEvent.press(await view.findByTestId('chats-tab'));
  await openOnlyChat(current, 'a whale breaching at sunset');
  await view.findByText(/The video engine ran out of memory\./, {}, { timeout: 15_000 });
  expect(view.queryByTestId('chat-clip-card')).toBeNull();
}, 90_000);
