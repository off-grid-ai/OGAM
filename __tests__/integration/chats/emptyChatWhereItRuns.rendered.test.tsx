/**
 * A new chat says where it runs.
 *
 * SPEC (OGAM user's view): with a model on this phone, the empty chat says everything is processed
 * on the device. With a model on a paired computer it never says that: it says the chat runs on a
 * remote server.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk and the RAM sensor.
 */
import { launchApp, openNewChat, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

let app: AnalyticsApp | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  app = undefined;
  restoreBuildFlavor();
});

it('a model on this phone: the empty chat says it is all processed on the device', async () => {
  app = await launchApp({ release: false });
  await passOnboarding(app, false);
  await openNewChat(app);
  await app.view.findByText(/All processing happens on your device/);
}, 60_000);

it('a model on a paired computer: the empty chat says it runs on a remote server, never "on your device"', async () => {
  app = await launchApp({ release: false });
  const { view, rtl } = app;
  await passOnboarding(app, false);
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const server = await remoteServerManager.addServer({
    name: 'Studio Mac',
    endpoint: 'http://192.168.1.50:7878',
    providerType: 'openai-compatible',
    modelCatalog: { text: [{ id: 'qwen', name: 'Qwen on the Mac' }] },
  });
  rtl.fireEvent.press(await view.findByTestId('browse-models-button'));
  rtl.fireEvent.press(await view.findByTestId(`remote-text-model-${server.id}-qwen`));
  rtl.fireEvent.press(await view.findByTestId('new-chat-button', {}, { timeout: 5000 }));
  await view.findByTestId('chat-input');
  await view.findByText(/runs on a remote server/);
  expect(view.queryByText(/All processing happens on your device/)).toBeNull();
}, 60_000);
