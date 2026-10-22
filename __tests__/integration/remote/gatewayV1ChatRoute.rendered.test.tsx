/**
 * A chat through a gateway saved with a /v1 address reaches the chat route and streams (2164a727).
 *
 * SPEC (OGAM user's view): I add my gateway as `http://192.168.1.20:1234/v1`, pick its model and
 * chat. My message reaches the server's chat route and the reply streams into the chat, then the
 * chat is idle again (no Stop button). If I press Stop before the request has gone out, nothing is
 * sent and the chat goes back to idle.
 *
 * The real App on the production navigation stack: Home, Remote Servers, the add-server form, the
 * model picker, the chat screen, the remote provider, SSE parser, generation service and stores all
 * run. Fakes only at the device boundary: the network - discovery over `fetch`
 * (harness/keyedRemoteServer, an LM Studio with no key) and the streaming chat over XMLHttpRequest
 * (harness/routedStreamServer, which answers ONLY POST /v1/chat/completions and 404s any other path,
 * such as /v1/v1/chat/completions) - the Keychain, the llama engine, the RAM sensor and the filesystem.
 */
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import {
  installKeyedServer,
  resetKeychain,
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';
import {
  installRoutedStreamServer,
  type RoutedStreamHandle,
} from '../../harness/routedStreamServer';
import { createDownloadedModel } from '../../utils/factories';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);
jest.setTimeout(60_000);

const ORIGIN = 'http://192.168.1.20:1234';
const ADDRESS = `${ORIGIN}/v1`;
const MODEL = 'acme-assistant-8b';
const SERVER_NAME = 'Desk Gateway';

let server: KeyedServerHandle | undefined;
let chat: RoutedStreamHandle | undefined;
let unmount: (() => void) | undefined;
let restoreVision: (() => void) | undefined;

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  restoreVision?.();
  restoreVision = undefined;
  chat?.restore();
  chat = undefined;
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
  return { view, rtl, boundary };
}

type App = Awaited<ReturnType<typeof launch>>;

/** This LM Studio serves a vision model: its native model list reports vision for it. */
function advertiseVisionAt(origin: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const response = await original(input, init);
    const url = new URL(href);
    if (url.origin !== origin || url.pathname !== '/api/v1/models' || !response.ok) return response;
    const body = await response.json();
    for (const model of body.models) model.capabilities.vision = true;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

/** Hold the device's file reads of one photo until release(), as slow storage does. */
function holdReadsOf(app: App, name: string) {
  const readFile = app.boundary.fs!.module.readFile;
  const real = readFile.getMockImplementation()!;
  let waiting: Array<() => void> = [];
  let released = false;
  readFile.mockImplementation(async (path: string, encoding?: string) => {
    if (!released && path.endsWith(name)) await new Promise<void>(resolve => waiting.push(resolve));
    return real(path, encoding);
  });
  return {
    pending: () => waiting.length > 0,
    release: () => { released = true; waiting.forEach(resolve => resolve()); waiting = []; },
  };
}

const remoteRowId = new RegExp(`^remote-text-model-.+-${MODEL}$`);

/** Add the gateway by its /v1 address, pick its model, and open a new chat - all by gesture. */
async function addGatewayPickModelOpenChat({ view, rtl }: App) {
  rtl.fireEvent.press(view.getByTestId('add-server-button'));
  rtl.fireEvent.press(await view.findByTestId('add-server'));
  rtl.fireEvent.changeText(await view.findByTestId('server-name'), SERVER_NAME);
  rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), ADDRESS);
  rtl.fireEvent.press(view.getByTestId('test-connection'));
  expect(await view.findByText(/Connected \(\d+ms\)\s+1 model available/)).toBeTruthy();
  rtl.fireEvent.press(view.getByTestId('save-server'));
  expect(await view.findByText(SERVER_NAME)).toBeTruthy();
  expect(await view.findByText('Connected')).toBeTruthy();
  rtl.fireEvent.press(view.getByLabelText('Back'));

  rtl.fireEvent.press(await view.findByTestId('browse-models-button'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId(remoteRowId)));
  await rtl.waitFor(() => expect(view.queryByTestId(remoteRowId)).toBeNull());

  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await view.findByTestId('chat-input');
}

describe('a gateway saved with a /v1 address', () => {
  beforeEach(() => {
    resetKeychain();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: '', modelId: MODEL });
  });

  it('sends the chat to its chat route and streams the reply into the chat', async () => {
    chat = installRoutedStreamServer({
      origin: ORIGIN, chatPath: '/v1/chat/completions',
      deltas: ['The tide ', 'turns twice ', 'a day.'], hold: true,
    });
    const app = await launch();
    const { view, rtl } = app;
    await addGatewayPickModelOpenChat(app);

    // BEFORE: an idle chat - no Stop button, no reply.
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(view.queryByText(/The tide/)).toBeNull();

    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'How often does the tide turn?');
    rtl.fireEvent.press(view.getByTestId('send-button'));

    // The first words stream in while the reply is still open: the chat shows Stop.
    expect(await view.findByText(/The tide/)).toBeTruthy();
    expect(view.getByTestId('stop-button')).toBeTruthy();
    expect(view.queryByText(/turns twice/)).toBeNull();

    chat.release();
    expect(await view.findByText(/The tide turns twice a day\./)).toBeTruthy();
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
    expect(view.queryByText(/Unexpected endpoint|404|Error/)).toBeNull();
  });

  it('Stop pressed before the request goes out sends nothing and returns the chat to idle', async () => {
    restoreVision = advertiseVisionAt(ORIGIN);
    chat = installRoutedStreamServer({
      origin: ORIGIN, chatPath: '/v1/chat/completions', deltas: ['Should never arrive.'],
    });
    const app = await launch();
    const { view, rtl } = app;
    // The photo the device picker hands back.
    app.boundary.fs!.seedFile('/mock/image.jpg', 2048);
    await addGatewayPickModelOpenChat(app);

    // Attach a photo through the real attach gesture.
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('attach-button')));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('attach-photo')));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Photo Library')));
    await rtl.waitFor(() => expect(view.queryByTestId('attachments-container')).not.toBeNull(),
      { timeout: 3000 });

    // The phone's storage is slow to hand the photo over: the request cannot go out until it does.
    const photoRead = holdReadsOf(app, 'image.jpg');

    // BEFORE: an idle chat, nothing sent.
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(chat.sent).toHaveLength(0);

    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'What is in this photo?');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    const stop = await view.findByTestId('stop-button');
    await rtl.waitFor(() => expect(photoRead.pending()).toBe(true));
    expect(chat.sent).toHaveLength(0);

    // The user presses Stop while the request is still being prepared, then the photo read finishes.
    rtl.fireEvent.press(stop);
    photoRead.release();

    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
    await new Promise(resolve => setTimeout(resolve, 200));
    // The chat stays idle, no reply arrives, and the server never received the request.
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(view.queryByText(/Should never arrive/)).toBeNull();
    expect(chat.sent).toEqual([]);
  });
});
