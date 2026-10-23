/**
 * Stop pressed before an Ollama chat request goes out sends nothing (the Ollama twin of
 * gatewayV1ChatRoute's Stop-before-send case).
 *
 * SPEC (OGAM user's view): I add my Ollama server, pick its vision model, attach a photo and send.
 * The reply streams into the chat. If I press Stop while the app is still preparing the request
 * (reading the photo), nothing is sent to the server and the chat goes back to idle — no reply, no
 * error.
 *
 * The real App on the production navigation stack: Home, Remote Servers, the add-server form, the
 * model picker, the chat screen, the remote provider's native Ollama path (/api/chat, NDJSON),
 * generation service and stores all run. Fakes only at the device boundary: discovery over `fetch`
 * (harness/keyedRemoteServer, an Ollama with no key), the streaming chat over XMLHttpRequest
 * (harness/routedStreamServer with Ollama's NDJSON wire, answering ONLY POST /api/chat), the
 * Keychain, the llama engine, the RAM sensor and the filesystem (whose photo read can be held).
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

// Ollama's own port: the provider takes its native /api/chat path for it.
const ORIGIN = 'http://192.168.1.30:11434';
const MODEL = 'llava:7b';
const SERVER_NAME = 'Home Ollama';

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

/** This Ollama serves a vision model: its /api/show reports the `vision` capability for it. */
function advertiseVisionAt(origin: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const response = await original(input, init);
    const url = new URL(href);
    if (url.origin !== origin || url.pathname !== '/api/show' || !response.ok) return response;
    const body = await response.json();
    body.capabilities = [...body.capabilities, 'vision'];
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

/** Add the Ollama server, pick its model, open a new chat and attach a photo - all by gesture. */
async function addOllamaPickModelAttachPhoto(app: App) {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('add-server-button'));
  rtl.fireEvent.press(await view.findByTestId('add-server'));
  rtl.fireEvent.changeText(await view.findByTestId('server-name'), SERVER_NAME);
  rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), ORIGIN);
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

  // The photo the device picker hands back, attached through the real attach gesture.
  app.boundary.fs!.seedFile('/mock/image.jpg', 2048);
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('attach-button')));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('attach-photo')));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Photo Library')));
  await rtl.waitFor(() => expect(view.queryByTestId('attachments-container')).not.toBeNull(),
    { timeout: 3000 });
}

describe('a chat with a photo on an Ollama server', () => {
  beforeEach(() => {
    resetKeychain();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'ollama', apiKey: '', modelId: MODEL });
    restoreVision = advertiseVisionAt(ORIGIN);
  });

  it('sends the chat to Ollama and streams the reply into the chat', async () => {
    chat = installRoutedStreamServer({
      origin: ORIGIN, chatPath: '/api/chat', wire: 'ndjson',
      deltas: ['A cat ', 'on a ', 'windowsill.'], hold: true,
    });
    const app = await launch();
    const { view, rtl } = app;
    await addOllamaPickModelAttachPhoto(app);

    // BEFORE: an idle chat - no Stop button, no reply, nothing sent.
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(view.queryByText(/A cat/)).toBeNull();
    expect(chat.sent).toHaveLength(0);

    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'What is in this photo?');
    rtl.fireEvent.press(view.getByTestId('send-button'));

    // The first words stream in while the reply is still open: the chat shows Stop.
    expect(await view.findByText(/A cat/)).toBeTruthy();
    expect(view.getByTestId('stop-button')).toBeTruthy();

    chat.release();
    expect(await view.findByText(/A cat on a windowsill\./)).toBeTruthy();
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
    expect(chat.sent).toEqual([{ method: 'POST', url: `${ORIGIN}/api/chat` }]);
  });

  it('Stop pressed before the request goes out sends nothing and returns the chat to idle', async () => {
    chat = installRoutedStreamServer({
      origin: ORIGIN, chatPath: '/api/chat', wire: 'ndjson', deltas: ['Should never arrive.'],
    });
    const app = await launch();
    const { view, rtl } = app;
    await addOllamaPickModelAttachPhoto(app);

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
    // The chat stays idle, no reply and no error arrive, and the server never received the request.
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(view.queryByText(/Should never arrive/)).toBeNull();
    expect(view.queryByText(/Error|Network error|timeout/i)).toBeNull();
    expect(chat.sent).toEqual([]);
  });
});
