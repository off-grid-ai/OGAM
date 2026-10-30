/**
 * Continue from a clip when the paired computer has no model that can start from a picture.
 *
 * SPEC (OGAM user's view): Continue stays on screen, muted. A tap opens one sheet that asks the
 * computer what it has and gives one next step:
 *  - a start-picture build downloading there: its progress, never a second download; when it lands
 *    the computer switches to it and Continue turns on;
 *  - a build already there: Use it;
 *  - otherwise the Light build that fits the computer (Full quality only with clear room), with
 *    "Make a new clip from a description" beside it; an older Desktop that does not report its memory
 *    is offered the Light build too;
 *  - a computer too small for any: how much memory it needs and has, and a new clip from a description.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor and
 * Desktop's gateway at `fetch` (its video jobs and its model manager). The clip is made the way a
 * person makes one: video mode in a chat, then Send.
 */
// The real navigator: studio screens open from chat (the default setup mocks useNavigation to a no-op).
jest.unmock('@react-navigation/native');

import {
  launchApp,
  passOnboarding,
  restoreBuildFlavor,
  type AnalyticsApp,
} from '../../harness/analyticsApp';
import {
  DESKTOP_VIDEO_ENDPOINT,
  DESKTOP_VIDEO_MODEL,
  serveDesktopVideoJobs,
  type DesktopVideoJobs,
} from '../../harness/desktopVideoServer';
import { serveDesktopModelPulls, type DesktopModelPulls } from '../../harness/desktopModelPulls';

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';

let app: AnalyticsApp | undefined;
let jobs: DesktopVideoJobs | undefined;
let models: DesktopModelPulls | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  models?.restore();
  jobs?.restore();
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  app = undefined;
  jobs = undefined;
  models = undefined;
  restoreBuildFlavor();
});

/** A clip made on the paired computer, in a chat, with Continue under it. */
async function clipInChat(computer: Parameters<typeof serveDesktopModelPulls>[0]): Promise<AnalyticsApp> {
  app = await launchApp({ release: false });
  const { view, rtl, boundary } = app;
  jobs = serveDesktopVideoJobs(boundary.fs!);
  models = serveDesktopModelPulls(computer);
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  // What pairing leaves behind; the person picks the computer's video model on Home.
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const server = await remoteServerManager.addServer({
    name: 'Studio Mac',
    endpoint: DESKTOP_VIDEO_ENDPOINT,
    providerType: 'openai-compatible',
    modelManagement: 'offgrid-desktop-v1',
    modelCatalog: { video: [DESKTOP_VIDEO_MODEL] },
  });
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  rtl.fireEvent.press(
    await view.findByTestId(`remote-video-model-${server.id}:${DESKTOP_VIDEO_MODEL.id}`, {}, { timeout: 5000 }),
  );
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a red fox trotting through fresh snow');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
  return app;
}

/** Continue is on screen but off; a tap opens the sheet. */
async function tapMutedContinue(current: AnalyticsApp) {
  const { view, rtl } = current;
  const continueChip = await view.findByTestId('video-continue');
  expect(continueChip.props.accessibilityState?.disabled).toBe(true);
  expect(view.queryByTestId('start-picture-sheet')).toBeNull();
  rtl.fireEvent.press(continueChip);
  await view.findByTestId('start-picture-sheet');
}

it('follows the download already running on the computer, then Continue turns on', async () => {
  const current = await clipInChat({ memoryGb: 34, downloading: { id: LIGHT, percent: 40 } });
  const { view, rtl } = current;
  models!.hold();
  await tapMutedContinue(current);
  await view.findByText('Downloading Wan 2.2 (5B), Light on your computer', {}, { timeout: 10_000 });
  expect(view.getByText(/^40% of /)).toBeTruthy();
  expect(view.queryByTestId('start-picture-download')).toBeNull();
  models!.release();
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  // No second download was started; the computer switched to the build that landed.
  expect(models!.pulls).toEqual([]);
  expect(models!.activations).toEqual([DESKTOP_VIDEO_MODEL.id, LIGHT]);
  rtl.fireEvent.press(view.getByTestId('start-picture-done'));
  await rtl.waitFor(() =>
    expect(view.getAllByTestId('video-continue')[0].props.accessibilityState?.disabled).toBe(false),
  );
}, 60_000);

it('stops waiting on a computer that stopped answering, and follows the download again once it answers', async () => {
  const current = await clipInChat({ memoryGb: 34, downloading: { id: LIGHT, percent: 40 } });
  const { view, rtl } = current;
  models!.hold();
  await tapMutedContinue(current);
  await view.findByText('Downloading Wan 2.2 (5B), Light on your computer', {}, { timeout: 10_000 });
  // The computer stops answering while the phone follows the download.
  models!.goSilent();
  // The next status read goes out and gets no answer.
  await new Promise(resolve => setTimeout(resolve, 2_500));
  expect(view.getByText('Downloading Wan 2.2 (5B), Light on your computer')).toBeTruthy();
  rtl.fireEvent.press(view.getByTestId('start-picture-stop'));
  await rtl.waitFor(() => expect(view.queryByTestId('start-picture-sheet')).toBeNull());
  expect(models!.aborted).toEqual(['GET /v1/models/pull/status']);
  // Back, and the download carried on there: the next opening follows it to the end.
  models!.answer();
  models!.release();
  await tapMutedContinue(current);
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  expect(models!.pulls).toEqual([]);
}, 60_000);

it('offers the Light build on a computer without clear room for Full quality, and downloads it once', async () => {
  const current = await clipInChat({ memoryGb: 34 });
  const { view, rtl } = current;
  await tapMutedContinue(current);
  await view.findByText('Continue needs Wan 2.2 (5B), Light, a 7.9 GB download.', {}, { timeout: 10_000 });
  expect(view.getByTestId('start-picture-describe')).toBeTruthy();
  models!.hold();
  rtl.fireEvent.press(view.getByTestId('start-picture-download'));
  await view.findByText('Downloading Wan 2.2 (5B), Light on your computer', {}, { timeout: 10_000 });
  models!.release();
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  expect(models!.pulls).toEqual([{ id: LIGHT }]);
}, 60_000);

it('offers Full quality on a computer with clear room', async () => {
  const current = await clipInChat({ memoryGb: 64 });
  await tapMutedContinue(current);
  await current.view.findByText('Continue needs Wan 2.2 (5B), a 10.4 GB download.', {}, { timeout: 10_000 });
}, 60_000);

it('offers the Light build to an older Desktop that does not report its memory', async () => {
  const current = await clipInChat({});
  await tapMutedContinue(current);
  await current.view.findByText('Continue needs Wan 2.2 (5B), Light, a 7.9 GB download.', {}, { timeout: 10_000 });
}, 60_000);

it('says a computer is too small, and offers a new clip from a description', async () => {
  const current = await clipInChat({ memoryGb: 8 });
  const { view } = current;
  await tapMutedContinue(current);
  await view.findByText(
    'Starting from a picture needs 12 GB of memory. Your computer has 8 GB.',
    {},
    { timeout: 10_000 },
  );
  expect(view.getByTestId('start-picture-describe')).toBeTruthy();
  expect(view.queryByTestId('start-picture-download')).toBeNull();
}, 60_000);

it('uses a start-picture build installed on the computer since the phone last looked', async () => {
  const current = await clipInChat({ memoryGb: 34 });
  const { view, rtl } = current;
  models!.install(LIGHT);
  await tapMutedContinue(current);
  await view.findByText('Continue needs Wan 2.2 (5B), Light. It is on your computer.', {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getByTestId('start-picture-use'));
  await view.findByText('Wan 2.2 (5B), Light is ready.', {}, { timeout: 15_000 });
  expect(models!.pulls).toEqual([]);
  expect(models!.activations).toEqual([DESKTOP_VIDEO_MODEL.id, LIGHT]);
  rtl.fireEvent.press(view.getByTestId('start-picture-done'));
  await rtl.waitFor(() =>
    expect(view.getAllByTestId('video-continue')[0].props.accessibilityState?.disabled).toBe(false),
  );
}, 60_000);

it('the storyboard\'s muted Start from a photo opens the sheet, with the shot kept from its description', async () => {
  const current = await clipInChat({ memoryGb: 34 });
  const { view, rtl } = current;
  rtl.fireEvent.press(await view.findByTestId('video-make-story'));
  const photo = await view.findByTestId('shot-photo-0', {}, { timeout: 15_000 });
  expect(photo.props.accessibilityState?.disabled).toBe(true);
  expect(view.queryByTestId('start-picture-sheet')).toBeNull();
  rtl.fireEvent.press(photo);
  await view.findByText(
    'Starting from a photo needs Wan 2.2 (5B), Light, a 7.9 GB download.',
    {},
    { timeout: 10_000 },
  );
  expect(view.getByText('Keep this shot from its description')).toBeTruthy();
}, 60_000);

it('the viewer\'s muted Continue opens the same sheet', async () => {
  const current = await clipInChat({ memoryGb: 34 });
  const { view, rtl } = current;
  rtl.fireEvent.press(view.getByTestId('chat-clip-card'));
  const continueAction = await view.findByTestId('viewer-continue', {}, { timeout: 10_000 });
  expect(continueAction.props.accessibilityState?.disabled).toBe(true);
  expect(view.queryByTestId('start-picture-sheet')).toBeNull();
  rtl.fireEvent.press(continueAction);
  await view.findByText('Continue needs Wan 2.2 (5B), Light, a 7.9 GB download.', {}, { timeout: 10_000 });
}, 60_000);

it('says to connect a computer when none is paired, instead of checking one forever', async () => {
  const current = await clipInChat({ memoryGb: 34 });
  const { view } = current;
  // The computer goes away between the clip and the tap: nothing is left to ask.
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  await tapMutedContinue(current);
  await view.findByText('Connect Off Grid AI Desktop first.', {}, { timeout: 10_000 });
  expect(view.queryByTestId('start-picture-checking')).toBeNull();
  expect(view.getByTestId('start-picture-retry')).toBeTruthy();
  expect(view.getByTestId('start-picture-describe')).toBeTruthy();
}, 60_000);
