/** P1 #138 — configure, select, and chat with a remote model through the real App. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

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

describe('P1 full-App remote model reply journey', () => {
  it('streams a reply after the user configures and selects a remote model', async () => {
    installRemoteDiscoveryBoundary();
    const { rtl, view } = await renderMainApp();
    await openRemoteChatThroughApp(rtl, view);

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
