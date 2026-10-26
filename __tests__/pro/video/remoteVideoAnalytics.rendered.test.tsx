/**
 * Video in opt-in analytics (docs/ANALYTICS.md: Generation, Actions).
 *
 * SPEC (OGAM user's view): a person who shares usage and makes a video in a chat on their Off Grid
 * Desktop sends one `generation_finished` with modality `video` (engine and backend `remote`, an
 * outcome and a duration) and `feature_used` `video_generation`. The prompt never leaves the phone
 * for PostHog. The video itself appears in the chat.
 *
 * The real App runs as a store build. Device boundaries only: the llama.rn engine, the disk, the
 * RAM sensor, Desktop's gateway and the PostHog endpoint at `fetch`. Desktop's saved server record
 * is what pairing leaves behind; its video model is picked in the real remote-model picker.
 */
import {
  launchApp,
  passOnboarding,
  restoreBuildFlavor,
  sendToBackground,
  type AnalyticsApp,
} from '../../harness/analyticsApp';
import {
  DESKTOP_VIDEO_ENDPOINT,
  DESKTOP_VIDEO_MODEL,
  serveDesktopVideoJobs,
  type DesktopVideoJobs,
} from '../../harness/desktopVideoServer';

const PROMPT = 'a paper boat drifting down a rainy street';

let app: AnalyticsApp | undefined;
let desktop: DesktopVideoJobs | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  desktop?.restore();
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  app = undefined;
  desktop = undefined;
  restoreBuildFlavor();
});

/**
 * The paired Desktop's saved record is what pairing leaves behind (as in remoteImageServer). The
 * person then picks its video model from Home's Video row; Desktop activates it.
 */
async function chooseDesktopVideoModel(current: AnalyticsApp): Promise<void> {
  const { view, rtl } = current;
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const server = await remoteServerManager.addServer({
    name: 'Studio Mac',
    endpoint: DESKTOP_VIDEO_ENDPOINT,
    providerType: 'openai-compatible',
    modelManagement: 'offgrid-desktop-v1',
    modelCatalog: { video: [DESKTOP_VIDEO_MODEL] },
  });
  expect(view.queryByTestId('new-chat-button')).toBeNull();
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  rtl.fireEvent.press(await view.findByTestId(`remote-video-model-${server.id}:${DESKTOP_VIDEO_MODEL.id}`, {}, { timeout: 5000 }));
  await view.findByTestId('new-chat-button', {}, { timeout: 5000 });
}

it('a Desktop video in a chat sends a video generation_finished, never the prompt', async () => {
  app = await launchApp({ release: true });
  const current = app;
  const { view, rtl, endpoint, boundary } = current;
  desktop = serveDesktopVideoJobs(boundary.fs!);
  await passOnboarding(current, true);
  // Video is Pro: the person activates it, as with a key.
  await require('../../harness/proHarness').installPro();
  await chooseDesktopVideoModel(current);
  // A video model alone is enough to start a chat.
  rtl.fireEvent.press(await view.findByTestId('new-chat-button'));
  await view.findByTestId('chat-input');

  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  const videoMode = await view.findByTestId('quick-video-mode');
  expect(videoMode.props.accessibilityState?.selected).toBe(false);
  rtl.fireEvent.press(videoMode);
  await rtl.waitFor(() =>
    expect(view.getByTestId('quick-video-mode').props.accessibilityState?.selected).toBe(true),
  );

  expect(view.queryByTestId('message-bubble')).toBeNull();
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), PROMPT);
  rtl.fireEvent.press(view.getByTestId('send-button'));
  // The prompt reached Desktop, and the finished clip shows in the chat.
  await rtl.waitFor(() => expect(desktop!.submissions).toHaveLength(1), { timeout: 10_000 });
  expect(desktop!.submissions[0].prompt).toBe(PROMPT);
  await rtl.waitFor(
    () => expect(view.queryAllByTestId('message-bubble').length).toBeGreaterThanOrEqual(2),
    { timeout: 15_000 },
  );

  await sendToBackground(current);
  await rtl.waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(1), { timeout: 10_000 });
  const finished = endpoint.named('generation_finished')[0].properties;
  expect(finished).toMatchObject({ modality: 'video', engine: 'remote', backend: 'remote', model: 'custom', outcome: 'done' });
  expect(typeof finished.duration_ms).toBe('number');
  expect(endpoint.named('feature_used').map(e => e.properties.feature)).toContain('video_generation');
  for (const body of endpoint.bodies) expect(body).not.toContain('paper boat');
});
