/**
 * Turning on video in a chat when this phone has no video model.
 *
 * SPEC (OGAM user's view): I never meet a dead end.
 *  - A paired computer that makes videos: video turns on and the clip is made there. No question.
 *  - No computer paired: a sheet says videos are made on a computer and offers "Find my computer",
 *    which opens the screen where I pair one.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk and the RAM sensor.
 */
jest.unmock('@react-navigation/native');

import { launchApp, openNewChat, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';
import { DESKTOP_VIDEO_ENDPOINT, DESKTOP_VIDEO_MODEL } from '../../harness/desktopVideoServer';

let app: AnalyticsApp | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  app = undefined;
  restoreBuildFlavor();
});

async function chatWithVideoOff(paired: boolean): Promise<AnalyticsApp> {
  app = await launchApp({ release: false });
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  if (paired) {
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.addServer({
      name: 'Studio Mac',
      endpoint: DESKTOP_VIDEO_ENDPOINT,
      providerType: 'openai-compatible',
      modelManagement: 'offgrid-desktop-v1',
      modelCatalog: { video: [DESKTOP_VIDEO_MODEL] },
      mediaModels: { video: DESKTOP_VIDEO_MODEL.id },
    });
  }
  await openNewChat(app);
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  expect((await view.findByTestId('quick-video-mode')).props.accessibilityState.selected).toBe(false);
  return app;
}

it('with no computer paired, video offers "Find my computer", which opens where I pair one', async () => {
  const { view, rtl } = await chatWithVideoOff(false);
  rtl.fireEvent.press(view.getByTestId('quick-video-mode'));
  await view.findByText('Videos are made on your computer');
  expect(view.queryByText(/Run models this phone cannot hold/)).toBeNull();
  rtl.fireEvent.press(view.getByText('Find my computer'));
  await view.findByText(/Run models this phone cannot hold/);
}, 90_000);

it('with a computer that makes videos paired, video turns on with no question', async () => {
  const { view, rtl } = await chatWithVideoOff(true);
  rtl.fireEvent.press(view.getByTestId('quick-video-mode'));
  await rtl.waitFor(() => expect(view.getByTestId('quick-video-mode').props.accessibilityState.selected).toBe(true));
  expect(view.queryByText('Videos are made on your computer')).toBeNull();
}, 90_000);
