/**
 * Extend a clip when the video model in use starts only from words, on a phone that can run a model
 * that starts from a picture.
 *
 * SPEC (OGAM user's view): Extend is muted. A tap opens one sheet with one next step, in this order:
 *  - the paired computer already has a start-picture model: "Extend on your computer", no download,
 *    and Extend goes on by itself once the computer switched to it;
 *  - otherwise this phone downloads one (its size shown; no "Connect your computer" beside it), and
 *    Extend goes on by itself when the download lands;
 *  - a download that will not fit says how much to free, and offers Storage instead of the download.
 * A new clip from a description stays beside each step.
 *
 * The real App runs, as a phone build with its native video engine. Device boundaries only: the llama.rn
 * engine, the disk (and its free space), the background downloader, the RAM sensor and Desktop's gateway
 * at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const CLIP = 'a red fox trotting through fresh snow';
const GB = 1024 ** 3;

async function tapMutedExtend(app: StudioApp) {
  const { view, rtl } = app;
  const extend = await view.findByTestId('video-continue');
  expect(extend.props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent.press(extend);
  await view.findByTestId('start-picture-sheet');
}

it('uses the start-picture model already on the computer, with no download, and Extend goes on by itself', async () => {
  const app = await launchStudioApp({ memoryGb: 34 }, { phoneEngine: true, download: true });
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  app.models.install(LIGHT);
  await tapMutedExtend(app);
  const use = await view.findByTestId('start-picture-use', {}, { timeout: 10_000 });
  expect(view.getByText('Extend on your computer')).toBeTruthy();
  expect(view.queryByTestId('start-picture-get-phone')).toBeNull();
  rtl.fireEvent.press(use);
  // No second tap: once the computer switched, Extend asks what happens next.
  await view.findByTestId('extend-sheet', {}, { timeout: 15_000 });
  expect(app.models.pulls).toEqual([]);
  expect(app.boundary.download!.active()).toEqual([]);
}, 90_000);

it('downloads the model on this phone when the computer has none, then Extend goes on by itself', async () => {
  const app = await launchStudioApp({ memoryGb: 34 }, { phoneEngine: true, download: true });
  const { view, rtl } = app;
  await makeClipInChat(app, CLIP);
  await tapMutedExtend(app);
  const get = await view.findByTestId('start-picture-get-phone', {}, { timeout: 10_000 });
  expect(view.getByText(/^Extend needs .+, a \d+\.\d GB download\.$/)).toBeTruthy();
  // The phone's download is the one step: no computer download and no Connect beside it.
  expect(view.queryByTestId('start-picture-download')).toBeNull();
  expect(view.queryByTestId('start-picture-connect')).toBeNull();
  expect(view.getByTestId('start-picture-describe')).toBeTruthy();
  rtl.fireEvent.press(get);
  await view.findByText(/^Downloading .+ on this phone$/, {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(app.boundary.download!.active().length).toBeGreaterThan(0));
  expect(app.models.pulls).toEqual([]);
  // What a finished download leaves on the phone: the pack, installed.
  const { CATALOG } = require('@offgrid/models');
  const { useAppStore } = require('../../../src/stores');
  const pack = CATALOG.find((model: { id: string }) => model.id === app.boundary.download!.active()[0].modelId?.replace(/^video:/, ''));
  rtl.act(() => {
    useAppStore.getState().addDownloadedVideoModel({ ...pack, kind: 'video', downloadedAt: new Date().toISOString() });
  });
  await view.findByTestId('extend-sheet', {}, { timeout: 10_000 });
  expect(useAppStore.getState().activeVideoModelId).toBe(pack.id);
}, 90_000);

it('says how much to free when the download will not fit, instead of offering it', async () => {
  const app = await launchStudioApp({ memoryGb: 34 }, { phoneEngine: true, download: true });
  const { view } = app;
  await makeClipInChat(app, CLIP);
  app.boundary.fs!.setFreeBytes(1 * GB);
  await tapMutedExtend(app);
  await view.findByTestId('start-picture-free-space', {}, { timeout: 10_000 });
  expect(view.getByText(/^Free \d+\.\d GB more on this phone to get it\.$/)).toBeTruthy();
  expect(view.queryByTestId('start-picture-get-phone')).toBeNull();
  expect(view.getByTestId('start-picture-describe')).toBeTruthy();
}, 90_000);

it('offers the phone download, not Connect, when no computer is paired', async () => {
  const app = await launchStudioApp({ memoryGb: 34 }, { phoneEngine: true, download: true });
  const { view } = app;
  await makeClipInChat(app, CLIP);
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  await tapMutedExtend(app);
  await view.findByTestId('start-picture-get-phone', {}, { timeout: 10_000 });
  expect(view.queryByTestId('start-picture-connect')).toBeNull();
}, 90_000);
