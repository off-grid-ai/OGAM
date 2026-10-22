/**
 * A keyed server that refuses discovery keeps the models the user already saw (354f7a94).
 *
 * SPEC (OGAM user's view): I add my LAN model server with its API key. The model picker lists its
 * model with what it can do (Tool calling). Later the server stops accepting that key. When I open
 * the app again, the app's startup refresh is refused - and the picker still shows the model with
 * the capabilities it had, never a model that has suddenly lost them. Testing the server says the
 * key was rejected.
 *
 * The real App on the production navigation stack: Home, Remote Servers, the add-server form, the
 * model picker, the remote-server manager, stores, discovery and capability probes all run. Fakes
 * only at the device boundary: the network (harness/keyedRemoteServer, an LM Studio that refuses any
 * request without its key), the Keychain, the llama engine, the RAM sensor and the filesystem. The
 * relaunch is a fresh module graph over the same app storage and Keychain.
 */
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import {
  installKeyedServer,
  resetKeychain,
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';
import { createDownloadedModel } from '../../utils/factories';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);
jest.setTimeout(60_000);

const ORIGIN = 'http://192.168.1.40:1234';
const API_KEY = 'lm-studio-key';
// A name the name-based guesses do not read as tool-capable: the badge can only come from the probes.
const MODEL = 'acme-assistant-8b';
const SERVER_NAME = 'Desk LM Studio';

let server: KeyedServerHandle | undefined;
let unmount: (() => void) | undefined;

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  server?.restore();
  server = undefined;
  await require('../../../src/services/generationService').generationService.stopGeneration();
  await require('../../../pro').deactivate();
});

/** Start the real app as a returning user with one local model on disk. */
async function launch(options: { preserveStorage?: boolean } = {}) {
  const boundary = installNativeBoundary({
    llama: true, fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const docs = boundary.fs!.DocumentDirectoryPath;
  const model = createDownloadedModel({
    id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: `${docs}/models/small.gguf`,
    engine: 'llama', fileSize: 500 * 1024 * 1024,
  });
  boundary.fs!.seedFile(model.filePath!, model.fileSize);
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.preserveStorage) {
    await storage.clear();
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model],
      devProDisabled: true, settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
  }
  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  unmount = () => view.unmount();
  await view.findByTestId('home-screen', {}, { timeout: 10_000 });
  return { view, rtl };
}

type App = Awaited<ReturnType<typeof launch>>;

const remoteRow = (app: App) =>
  app.view.getByTestId(new RegExp(`^remote-text-model-.+-${MODEL}$`));

/** Home > Select Model: the picker's row for the server's model. */
async function openPicker(app: App) {
  app.rtl.fireEvent.press(app.view.getByTestId('browse-models-button'));
  return app.rtl.waitFor(() => remoteRow(app));
}

describe('a keyed server that refuses discovery', () => {
  it('keeps the model and its capabilities the user already saw', async () => {
    resetKeychain();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: API_KEY, modelId: MODEL });

    // ── Launch 1: add the server with its key through the real form ────────────────────────────
    const app = await launch();
    const { view, rtl } = app;
    // BEFORE: the picker has the local model and no remote model.
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() => expect(view.getAllByText('Test Model').length).toBeGreaterThan(0));
    expect(view.queryByTestId(new RegExp(`^remote-text-model-.+-${MODEL}$`))).toBeNull();
    rtl.fireEvent.press(view.getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view.queryByTestId('app-sheet-close')).toBeNull());

    rtl.fireEvent.press(view.getByTestId('add-server-button'));
    rtl.fireEvent.press(await view.findByTestId('add-server'));
    rtl.fireEvent.changeText(await view.findByTestId('server-name'), SERVER_NAME);
    rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), ORIGIN);
    rtl.fireEvent.changeText(view.getByTestId('server-api-key'), API_KEY);
    rtl.fireEvent.press(view.getByTestId('test-connection'));
    expect(await view.findByText(/Connected \(\d+ms\)\s+1 model available/)).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('save-server'));
    expect(await view.findByText(SERVER_NAME)).toBeTruthy();
    expect(await view.findByText('Connected')).toBeTruthy();
    rtl.fireEvent.press(view.getByLabelText('Back'));

    // The picker lists the server's model with Tool calling, learned from the keyed probes.
    const row = await openPicker(app);
    expect(rtl.within(row).getByLabelText('Tool calling')).toBeTruthy();
    expect(server.requests.filter(request => !request.authorized)).toEqual([]);
    // Let the saved server and its models reach app storage before the app is closed.
    await new Promise(resolve => setTimeout(resolve, 50));
    unmount?.();

    // ── The server stops accepting the key, then the app is opened again ───────────────────────
    server.restore();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: 'rotated-key', modelId: MODEL });
    const next = await launch({ preserveStorage: true });

    // The startup refresh reached the server and was refused.
    await next.rtl.waitFor(() =>
      expect(server!.requests.some(r => r.path === '/v1/models' && !r.authorized)).toBe(true),
    );
    await new Promise(resolve => setTimeout(resolve, 50));

    // The picker still shows the model, still with Tool calling.
    const kept = await openPicker(next);
    expect(next.rtl.within(kept).getByLabelText('Tool calling')).toBeTruthy();
    expect(next.rtl.within(kept).getByText(MODEL)).toBeTruthy();

    // The refusal is real: testing the server says the key was rejected.
    next.rtl.fireEvent.press(next.view.getByTestId('app-sheet-close'));
    await next.rtl.waitFor(() => expect(next.view.queryByTestId('app-sheet-close')).toBeNull());
    next.rtl.fireEvent.press(next.view.getByTestId('add-server-button'));
    next.rtl.fireEvent.press(await next.view.findByText('Test'));
    expect(await next.view.findByText(/rejected the API key \(HTTP 401\)/)).toBeTruthy();
  });
});
