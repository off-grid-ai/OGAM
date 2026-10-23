/**
 * The real App on the production navigation stack, for opt-in analytics journeys.
 *
 * Device boundaries only: the llama.rn engine, an in-memory disk holding one downloaded model, the
 * RAM sensor, the OS app-state events, and the PostHog endpoint at `fetch`. A fresh install opens on
 * Onboarding, so every journey passes Auto Setup the way a new user does.
 */
import { GB, installNativeBoundary, requireRTL, type NativeBoundary } from './nativeBoundary';
import { installPostHogEndpoint, type PostHogEndpoint } from './postHogEndpoint';
import { createDownloadedModel } from '../utils/factories';

type DevGlobal = { __DEV__?: boolean };

export interface AnalyticsApp {
  boundary: NativeBoundary;
  endpoint: PostHogEndpoint;
  rtl: ReturnType<typeof requireRTL>;
  view: ReturnType<ReturnType<typeof requireRTL>['render']>;
}

const originalDev = (global as DevGlobal).__DEV__;

/** Put `__DEV__` back after a test that ran as a release build. */
export function restoreBuildFlavor(): void {
  (global as DevGlobal).__DEV__ = originalDev;
}

/**
 * Launch the App. `release: true` runs it as a store build (`__DEV__` false), the only build that
 * may start the analytics SDK. `relaunch: true` keeps the disk and storage of the previous launch.
 */
export async function launchApp(options: { release: boolean; relaunch?: boolean }): Promise<AnalyticsApp> {
  (global as DevGlobal).__DEV__ = !options.release;
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const endpoint = installPostHogEndpoint();
  const docs = boundary.fs!.DocumentDirectoryPath;
  const model = {
    ...createDownloadedModel({
    id: 'm',
    name: 'Test Model',
    fileName: 'small.gguf',
    filePath: `${docs}/models/small.gguf`,
    engine: 'llama',
    fileSize: 500 * 1024 * 1024,
    }),
    // Where a Hugging Face download records it came from (a public repo).
    origin: { repoId: 'unsloth/Qwen3-0.6B-GGUF', revision: 'main', path: 'small.gguf' },
  };
  // The disk a download leaves behind: the file and its record. Nothing else is pre-placed.
  boundary.fs!.seedFile(model.filePath!, model.fileSize);
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.relaunch) {
    await storage.clear();
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
  }
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(() => expect(view.queryByTestId('app-loading')).toBeNull(), { timeout: 10_000 });
  return { boundary, endpoint, rtl, view };
}

/** A new user: Onboarding → Auto Setup (ticking the share row or not) → Skip for Now → Home. */
export async function passOnboarding(app: AnalyticsApp, share: boolean): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('onboarding-skip'));
  const skip = await view.findByTestId('auto-setup-skip', {}, { timeout: 10_000 });
  const row = view.getByTestId('auto-setup-share-analytics');
  expect(row.props.accessibilityState).toEqual({ checked: false });
  if (share) {
    rtl.fireEvent.press(row);
    await rtl.waitFor(() =>
      expect(view.getByTestId('auto-setup-share-analytics').props.accessibilityState).toEqual({ checked: true }),
    );
  }
  rtl.fireEvent.press(skip);
  await view.findByTestId('home-screen');
}

export async function openNewChat(app: AnalyticsApp): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('browse-models-button'));
  rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
  await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await view.findByTestId('chat-input');
}

/** Type and send a message; the model's reply (scripted at the engine leaf) renders. */
export async function sendMessage(app: AnalyticsApp, prompt: string, reply: string): Promise<void> {
  const { view, rtl, boundary } = app;
  boundary.llama!.scriptCompletion({ text: reply });
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await view.findByText(reply, {}, { timeout: 10_000 });
  await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
}

/** The person leaves the app: the OS moves it to the background. */
export async function sendToBackground(app: AnalyticsApp): Promise<void> {
  await app.rtl.act(async () => {
    app.boundary.emitAppStateChange('background');
  });
}

export async function bringToForeground(app: AnalyticsApp): Promise<void> {
  await app.rtl.act(async () => {
    app.boundary.emitAppStateChange('active');
  });
}

/** From a chat: back to the tabs, then the Settings tab. */
export async function openSettings(app: AnalyticsApp): Promise<void> {
  const { view, rtl } = app;
  const back = view.queryAllByLabelText('Back');
  if (back.length > 0) rtl.fireEvent.press(back[0]);
  rtl.fireEvent.press(await view.findByTestId('settings-tab'));
  await view.findByTestId('settings-analytics');
}
