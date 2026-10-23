/**
 * A server on the private LAN over plain HTTP that needs no API key is found and checks OK (8964bc62).
 *
 * SPEC (OGAM user's view): I add my LM Studio at its LAN address (http://192.168.x.x). It needs no
 * key. Whether I leave the key field empty, or type a key it does not need, the check says Connected
 * with its model, the saved server reads Connected, and the model picker lists the model with what it
 * can do. Nothing tells me a key is required or refused.
 *
 * The real App on the production navigation stack: Home, Remote Servers, the add-server form, the
 * model picker, the remote-server manager, stores, discovery and capability probes all run. Fakes
 * only at the device boundary: the network (harness/keyedRemoteServer as an LM Studio with no key
 * set), the Keychain, the llama engine, the RAM sensor and the filesystem.
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
// A name the name-based guesses do not read as tool-capable: the badge can only come from the probes.
const MODEL = 'acme-assistant-8b';
const SERVER_NAME = 'Desk LM Studio';

let server: KeyedServerHandle | undefined;
let restoreHeaderDrop: (() => void) | undefined;
let unmount: (() => void) | undefined;

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  restoreHeaderDrop?.();
  restoreHeaderDrop = undefined;
  server?.restore();
  server = undefined;
  await require('../../../src/services/generationService').generationService.stopGeneration();
  await require('../../../pro').deactivate();
});

/**
 * LM Studio with no key set ignores an Authorization header. The shared fake refuses one, so drop the
 * header on its way to this origin: the server answers as if the request were anonymous.
 */
function ignoreAuthorizationAt(origin: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).origin !== origin || !init?.headers) return original(input, init);
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    return original(input, { ...init, headers });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

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
  { typedKey: '', label: 'with the key field left empty' },
  { typedKey: 'not-needed-key', label: 'with a key the server does not need' },
])('a keyless LM Studio on private-LAN HTTP, added $label', ({ typedKey }) => {
  it('checks Connected with its model, saves as Connected, and lists the model in the picker', async () => {
    resetKeychain();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: '', modelId: MODEL });
    if (typedKey) restoreHeaderDrop = ignoreAuthorizationAt(ORIGIN);

    const { view, rtl } = await launch();

    // BEFORE: the picker has the local model and no remote model.
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() => expect(view.getAllByText('Test Model').length).toBeGreaterThan(0));
    expect(view.queryByTestId(remoteRowId)).toBeNull();
    rtl.fireEvent.press(view.getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view.queryByTestId('app-sheet-close')).toBeNull());

    // Add the server through the real form.
    rtl.fireEvent.press(view.getByTestId('add-server-button'));
    rtl.fireEvent.press(await view.findByTestId('add-server'));
    rtl.fireEvent.changeText(await view.findByTestId('server-name'), SERVER_NAME);
    rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), ORIGIN);
    if (typedKey) rtl.fireEvent.changeText(view.getByTestId('server-api-key'), typedKey);
    // BEFORE the check: no result is shown and the server cannot be added yet.
    expect(view.queryByText(/Connected \(/)).toBeNull();

    rtl.fireEvent.press(view.getByTestId('test-connection'));
    expect(await view.findByText(/Connected \(\d+ms\)\s+1 model available/)).toBeTruthy();
    expect(view.queryByText(/rejected the API key|only sent over HTTPS|key is required/i)).toBeNull();

    // The private address saves without the public-internet warning.
    rtl.fireEvent.press(view.getByTestId('save-server'));
    expect(await view.findByText(SERVER_NAME)).toBeTruthy();
    expect(view.queryByText('Public Network Warning')).toBeNull();
    expect(await view.findByText('Connected')).toBeTruthy();
    expect(view.queryByText('Not answering')).toBeNull();

    // Tapping Test on the saved row keeps it Connected, with no failure dialog.
    rtl.fireEvent.press(view.getByText('Test'));
    // Let the check finish: a failure would open its dialog and mark the row Not answering.
    await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    await rtl.waitFor(() => expect(view.getByText('Test')).toBeTruthy());
    expect(view.getByText('Connected')).toBeTruthy();
    expect(view.queryByText('Could not connect')).toBeNull();
    rtl.fireEvent.press(view.getByLabelText('Back'));

    // The picker now lists the server's model, with Tool calling from the server's own probes.
    rtl.fireEvent.press(await view.findByTestId('browse-models-button'));
    const row = await rtl.waitFor(() => view.getByTestId(remoteRowId));
    expect(rtl.within(row).getByText(MODEL)).toBeTruthy();
    expect(rtl.within(row).getByLabelText('Tool calling')).toBeTruthy();
  });
});
