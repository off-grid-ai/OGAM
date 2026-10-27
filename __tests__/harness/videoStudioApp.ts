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

/** Home with Pro and the paired computer's video model picked. */
export async function launchStudioApp(computer: Parameters<typeof serveDesktopModelPulls>[0] = { memoryGb: 34 }): Promise<StudioApp> {
  const app = await launchApp({ release: false });
  const { view, rtl, boundary } = app;
  const jobs = serveDesktopVideoJobs(boundary.fs!);
  const models = serveDesktopModelPulls(computer);
  const stories = serveDesktopStoryJobs(boundary.fs!);
  // The OS dialog is a device surface: remember what it offers so the test can answer it like a person.
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
  current = { ...app, jobs, models, stories, dialog: () => dialog, answer };
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

/** afterEach: unmount and put every boundary back. */
export function closeStudioApp(): void {
  if (!current) return;
  current.view.unmount();
  current.endpoint.restore();
  current.stories.restore();
  current.models.restore();
  current.jobs.restore();
  require('../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  current = undefined;
  restoreBuildFlavor();
}
