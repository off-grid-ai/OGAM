/**
 * The real App with Pro, paired with Off Grid AI Desktop as its video computer, for Studio journeys.
 *
 * Device boundaries only (see analyticsApp): the llama.rn engine, the disk, the RAM sensor, and
 * Desktop's gateway at `fetch` (its video jobs, its model manager and its film jobs). Nothing in the app is seeded:
 * the computer's video model is picked on Home, and a clip is made the way a person makes one —
 * video mode in a chat, then Send.
 *
 * Callers unmock '@react-navigation/native' so the studio screens open on the real navigator.
 */
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from './analyticsApp';
import type { NativeBoundary } from './nativeBoundary';
import {
  DESKTOP_VIDEO_ENDPOINT,
  DESKTOP_VIDEO_MODEL,
  serveDesktopVideoJobs,
  type DesktopVideoJobs,
} from './desktopVideoServer';
import { serveDesktopModelPulls, type DesktopModelPulls } from './desktopModelPulls';
import { serveDesktopStoryJobs, type DesktopStoryJobs } from './desktopStoryJobs';

export interface StudioApp extends AnalyticsApp {
  jobs: DesktopVideoJobs;
  models: DesktopModelPulls;
  stories: DesktopStoryJobs;
  /** The OS dialog on screen now (Alert.alert), or null. */
  dialog: () => OsDialog | null;
  /** Tap a button on the OS dialog on screen, as a person would. */
  answer: (button: string) => Promise<void>;
}

export interface OsDialog {
  title: string;
  message?: string;
  buttons: Array<{ text?: string; onPress?: () => void }>;
}

let current: StudioApp | undefined;
/** PostHog endpoints of earlier launches in this test, put back last (they sit under the Desktop fakes). */
let earlierEndpoints: Array<{ restore: () => void }> = [];

/** The OS dialog is a device surface: remember what it offers so the test can answer it like a person. */
function osDialog(rtl: AnalyticsApp['rtl']): Pick<StudioApp, 'dialog' | 'answer'> {
  let dialog: OsDialog | null = null;
  require('react-native').Alert.alert = (title: string, message?: string, buttons?: OsDialog['buttons']) => {
    dialog = { title, message, buttons: buttons ?? [{ text: 'OK' }] };
  };
  const answer = async (button: string) => {
    const shown = dialog;
    if (!shown) throw new Error(`No dialog is on screen to answer "${button}".`);
    const choice = shown.buttons.find(item => item.text === button);
    if (!choice) throw new Error(`The dialog "${shown.title}" has no "${button}" button.`);
    dialog = null;
    await rtl.act(async () => {
      choice.onPress?.();
    });
  };
  return { dialog: () => dialog, answer };
}

/** Home with Pro and the paired computer's video model picked. */
export async function launchStudioApp(
  computer: Parameters<typeof serveDesktopModelPulls>[0] = { memoryGb: 34 },
  options: {
    imageModel?: boolean;
    /** The phone's native video engine and film composer (a phone build that has them). */
    phoneEngine?: boolean;
  } = {},
): Promise<StudioApp> {
  const app = await launchApp({
    release: false,
    beforeApp: boundary => {
      if (options.imageModel) placeImageModel(boundary);
      if (options.phoneEngine) require('./nativeVideoEngine').installNativeVideoEngine(boundary);
    },
  });
  const { view, rtl, boundary } = app;
  const jobs = serveDesktopVideoJobs(boundary.fs!);
  const models = serveDesktopModelPulls(computer);
  const stories = serveDesktopStoryJobs(boundary.fs!);
  current = { ...app, jobs, models, stories, ...osDialog(rtl) };
  await passOnboarding(app, false);
  await require('./proHarness').installPro();
  // What pairing leaves behind; the person picks the computer's video model on Home.
  const { remoteServerManager } = require('../../src/services/remoteServerManager');
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
  return current;
}

/**
 * A downloaded image model, as a finished download leaves it: its files on disk (MNN, the Android
 * runtime) and its record in storage. It is picked in the chat with the image-mode toggle.
 */
function placeImageModel(boundary: NativeBoundary): void {
  const directory = `${boundary.fs!.DocumentDirectoryPath}/image_models/sd`;
  for (const name of [
    'pos_emb.bin', 'token_emb.bin', 'tokenizer.json', 'unet.mnn', 'unet.mnn.weight',
    'vae_decoder.mnn', 'vae_decoder.mnn.weight', 'clip_v2.mnn', 'clip_v2.mnn.weight',
  ])
    boundary.fs!.seedFile(`${directory}/${name}`, 8 * 1024 * 1024);
  const { createONNXImageModel } = require('../utils/factories');
  const model = createONNXImageModel({ id: 'sd', name: 'SD', modelPath: directory, backend: 'mnn' });
  const storage = require('@react-native-async-storage/async-storage');
  storage.setItem('@local_llm/downloaded_image_models', JSON.stringify([model]));
}

/** From Home: a new chat, video mode, a description, Send — and the clip card it leaves. */
export async function makeClipInChat(app: StudioApp, prompt: string): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-video-mode'));
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByTestId('chat-clip-card', {}, { timeout: 15_000 });
}

/**
 * The app is closed and opened again: the phone's storage stays (its disk is a new one), and the
 * paired computer keeps every job it was running. Opens on Home.
 */
export async function relaunchStudioApp(): Promise<StudioApp> {
  const before = current!;
  before.view.unmount();
  earlierEndpoints.push(before.endpoint);
  const app = await launchApp({ release: false, relaunch: true });
  before.jobs.useDisk(app.boundary.fs!);
  before.stories.useDisk(app.boundary.fs!);
  await require('./proHarness').installPro();
  current = { ...app, jobs: before.jobs, models: before.models, stories: before.stories, ...osDialog(app.rtl) };
  await app.view.findByTestId('home-screen', {}, { timeout: 10_000 });
  return current;
}

/** How long the paired computer must go unasked before a test may put its fakes away (polls run every 1-3 s). */
const QUIET_MS = 4000;

/**
 * afterEach: let every clip and film still on its way settle, then unmount and put every boundary
 * back. Held jobs are released first, so nothing a test left running polls a restored `fetch` (the
 * real network) after it ends — including a launch the test closed with relaunchStudioApp.
 */
export async function closeStudioApp(): Promise<void> {
  if (!current) return;
  const app = current;
  app.jobs.release();
  app.stories.release();
  app.models.release();
  const { videoSeam } = require('../../src/bootstrap/videoSeam');
  await app.rtl.waitFor(() => expect(videoSeam.hasPending() || videoSeam.isBusy()).toBe(false), { timeout: 30_000 });
  await app.rtl.waitFor(
    () => expect(Date.now() - Math.max(app.jobs.lastRequestAt(), app.stories.lastRequestAt())).toBeGreaterThan(QUIET_MS),
    { timeout: 30_000, interval: 250 },
  );
  // What ending Pro does: stop every render and the charger watch, so no timer outlives the test.
  require('../../pro/video/studio/filmRenderer').stopAllRenders();
  app.view.unmount();
  app.endpoint.restore();
  app.stories.restore();
  app.models.restore();
  app.jobs.restore();
  for (const endpoint of earlierEndpoints.reverse()) endpoint.restore();
  earlierEndpoints = [];
  require('../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  current = undefined;
  restoreBuildFlavor();
}
