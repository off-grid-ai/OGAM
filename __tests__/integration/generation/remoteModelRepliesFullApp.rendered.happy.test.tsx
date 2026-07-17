/** P1 #138 — configure, select, and chat with a remote model through the real App. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const SERVER_NAME = 'My LM Studio';
const ENDPOINT = 'http://localhost:1234';
const MODEL_ID = 'llama-3-8b';
const PARTIAL_REPLY = 'Hello from the remote';
const FULL_REPLY =
  'Hello from the remote model. Your chat is using LM Studio over the local network.';
const REMOTE_REPLY_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  `data: {"choices":[{"delta":{"content":"${PARTIAL_REPLY}"}}]}\n\n` +
  '__PAUSE__\n' +
  'data: {"choices":[{"delta":{"content":" model. Your chat is using LM Studio over the local network."}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

function installRemoteDiscoveryBoundary(): void {
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: MODEL_ID, object: 'model', owned_by: 'local' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('P1 full-App remote model reply journey', () => {
  it('streams a reply after the user configures and selects a remote model', async () => {
    installRemoteDiscoveryBoundary();
    const { rtl, view } = await renderMainApp();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Remote Servers')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Remote Servers'));
    await rtl.waitFor(() =>
      expect(view.getByText('No Remote Servers')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByText('Add Server'));
    rtl.fireEvent.changeText(
      await rtl.waitFor(() =>
        view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
      ),
      SERVER_NAME,
    );
    rtl.fireEvent.changeText(
      view.getByPlaceholderText('http://192.168.1.50:7878'),
      ENDPOINT,
    );
    rtl.fireEvent.press(view.getByText('Test Connection'));
    await rtl.waitFor(
      () => expect(view.getByText(/Connected \(/)).toBeTruthy(),
      { timeout: 5000 },
    );
    const addButtons = view.getAllByText('Add Server');
    rtl.fireEvent.press(addButtons[addButtons.length - 1]);
    await rtl.waitFor(() => {
      expect(view.getByText(SERVER_NAME)).toBeTruthy();
      expect(view.getByText('Connected')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('remote-servers-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('settings-tab')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() => {
      expect(view.getByText(SERVER_NAME)).toBeTruthy();
      expect(view.getByText(MODEL_ID)).toBeTruthy();
      expect(view.getByTestId('remote-model-item')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByTestId('remote-model-item'));
    await rtl.waitFor(
      () => expect(view.getByTestId('new-chat-button')).toBeTruthy(),
      { timeout: 5000 },
    );
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    const stream = installRemoteStream(REMOTE_REPLY_SSE);
    sendChatMessage(rtl, view, 'Say hello and identify where you are running.');

    await rtl.waitFor(
      () => {
        expect(view.getByText(PARTIAL_REPLY)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 6000 },
    );

    stream.release();
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(FULL_REPLY)).toHaveLength(1);
        expect(view.queryByText(PARTIAL_REPLY)).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByText(/data:|\[DONE\]|choices/)).toBeNull();
      },
      { timeout: 6000 },
    );

    view.unmount();
  }, 30000);
});
