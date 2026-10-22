/**
 * A server address typed with a trailing /v1 checks and lists its models like the bare address (16479c4d).
 *
 * SPEC (OGAM user's view): I add my LM Studio and type its address the way its own UI shows it,
 * `http://192.168.1.20:1234/v1`. The check says Connected with its model, the saved server reads
 * Connected, and the model picker lists the model with what it can do (Tool calling) - exactly as
 * when I type `http://192.168.1.20:1234`.
 *
 * The real App on the production navigation stack: Home, Remote Servers, the add-server form, the
 * model picker, the remote-server manager, stores, health check, discovery and capability probes all
 * run. Fakes only at the device boundary: the network (harness/keyedRemoteServer, an LM Studio with
 * no key that answers only the paths LM Studio serves - /v1/models, /api/v1/models,
 * /v1/chat/completions - and 404s anything else, such as /v1/v1/models or /v1/api/v1/models), the
 * Keychain, the llama engine, the RAM sensor and the filesystem.
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

const ORIGIN = 'http://192.168.1.20:1234';
// A name the name-based guesses do not read as tool-capable: the badge can only come from the probes,
// which must reach /api/v1/models beside /v1, not under it.
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
async function launch() {
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
  await storage.clear();
  await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
  await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
    hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model],
    devProDisabled: true, settings: { autoDiscoverRemoteModels: false },
  }, version: 0 }));
  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  unmount = () => view.unmount();
  await view.findByTestId('home-screen', {}, { timeout: 10_000 });
  return { view, rtl };
}

const remoteRowId = new RegExp(`^remote-text-model-.+-${MODEL}$`);

describe.each([
  { typed: ORIGIN, label: 'the bare address' },
  { typed: `${ORIGIN}/v1`, label: 'the address ending in /v1' },
  { typed: `${ORIGIN}/v1/`, label: 'the address ending in /v1/' },
])('an LM Studio added by $label', ({ typed }) => {
  it('checks Connected, saves Connected, and lists its model with Tool calling', async () => {
    resetKeychain();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: '', modelId: MODEL });

    const { view, rtl } = await launch();

    // BEFORE: the picker has the local model and no remote model.
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() => expect(view.getAllByText('Test Model').length).toBeGreaterThan(0));
    expect(view.queryByTestId(remoteRowId)).toBeNull();
    rtl.fireEvent.press(view.getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view.queryByTestId('app-sheet-close')).toBeNull());

    // Add the server through the real form, typing the address as given.
    rtl.fireEvent.press(view.getByTestId('add-server-button'));
    rtl.fireEvent.press(await view.findByTestId('add-server'));
    rtl.fireEvent.changeText(await view.findByTestId('server-name'), SERVER_NAME);
    rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), typed);
    // BEFORE the check: no result shows.
    expect(view.queryByText(/Connected \(/)).toBeNull();

    rtl.fireEvent.press(view.getByTestId('test-connection'));
    expect(await view.findByText(/Connected \(\d+ms\)\s+1 model available/)).toBeTruthy();
    expect(view.queryByText(/Tried:/)).toBeNull();

    rtl.fireEvent.press(view.getByTestId('save-server'));
    expect(await view.findByText(SERVER_NAME)).toBeTruthy();
    expect(await view.findByText('Connected')).toBeTruthy();
    expect(view.queryByText('Not answering')).toBeNull();

    // Tapping Test on the saved row keeps it Connected, with no failure dialog.
    rtl.fireEvent.press(view.getByText('Test'));
    await rtl.waitFor(() => expect(view.getByText('Test')).toBeTruthy());
    expect(view.getByText('Connected')).toBeTruthy();
    expect(view.queryByText('Could not connect')).toBeNull();
    rtl.fireEvent.press(view.getByLabelText('Back'));

    // The picker lists the model with Tool calling - learned from LM Studio's own model list.
    rtl.fireEvent.press(await view.findByTestId('browse-models-button'));
    const row = await rtl.waitFor(() => view.getByTestId(remoteRowId));
    expect(rtl.within(row).getByText(MODEL)).toBeTruthy();
    expect(rtl.within(row).getByLabelText('Tool calling')).toBeTruthy();
  });
});
