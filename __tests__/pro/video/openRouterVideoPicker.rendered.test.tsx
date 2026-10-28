/**
 * OpenRouter's video models in the app's own picker.
 *
 * SPEC (OGAM user's view): I add OpenRouter with my key. Home's model sheet, under Video, lists its
 * video models under Remote models, beside the paired computer's. I tap one, and the clip I ask for in a chat
 * is made on OpenRouter with that model.
 *
 * The real App runs. Device boundaries only: OpenRouter at fetch and the download (see
 * openRouterVideoServer), the Keychain, and the Desktop fakes of videoStudioApp.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

import { closeStudioApp, launchStudioApp, makeClipInChat } from '../../harness/videoStudioApp';
import {
  OPENROUTER_ENDPOINT,
  OPENROUTER_KEY,
  OPENROUTER_VIDEO_MODEL,
  serveOpenRouterVideo,
  type OpenRouterVideoJobs,
} from '../../harness/openRouterVideoServer';

let openRouter: OpenRouterVideoJobs | undefined;

afterEach(async () => {
  openRouter?.restore();
  openRouter = undefined;
  await closeStudioApp();
}, 90_000);

it('lists OpenRouter video models in the Video model picker, and the one I tap makes my chat clip', async () => {
  const app = await launchStudioApp();
  const { view, rtl, boundary } = app;
  openRouter = serveOpenRouterVideo(boundary.fs!);

  // What the server editor saves after Test connection with my key.
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const found = await remoteServerManager.testConnectionByEndpoint(OPENROUTER_ENDPOINT, OPENROUTER_KEY);
  expect(found.modelCatalog?.video?.map((model: { id: string }) => model.id)).toContain(OPENROUTER_VIDEO_MODEL.id);
  const server = await remoteServerManager.addServer({
    name: 'OpenRouter',
    endpoint: OPENROUTER_ENDPOINT,
    providerType: 'openai-compatible',
    apiKey: OPENROUTER_KEY,
    mediaModels: {},
    modelCatalog: found.modelCatalog,
  });

  // Home's model sheet, Video: where a remote video model is picked (the paired computer's is there too).
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  const row = await view.findByTestId(`remote-video-model-${server.id}:${OPENROUTER_VIDEO_MODEL.id}`, {}, { timeout: 10_000 });
  rtl.fireEvent.press(row);
  await rtl.waitFor(() =>
    expect(require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().activeRemoteMediaServerIds.video).toBe(server.id),
  );

  await makeClipInChat(app, 'a lighthouse at dusk');
  await rtl.waitFor(() => expect(openRouter!.submissions).toHaveLength(1), { timeout: 30_000 });
  expect(openRouter!.submissions[0].model).toBe(OPENROUTER_VIDEO_MODEL.id);
  expect(app.jobs.submissions).toHaveLength(0);
}, 90_000);
