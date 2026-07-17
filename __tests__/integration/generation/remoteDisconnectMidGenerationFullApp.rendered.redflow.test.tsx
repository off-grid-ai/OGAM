/**
 * P1 #145 — if a configured remote server disappears after streaming visible tokens, keep that partial
 * answer, explain the disconnect durably, return the composer to idle, and allow the next send once the
 * server is back. The real App, remote-server form, discovery, model selection, provider, generation
 * service, stores, and Chat UI run; only HTTP discovery and the streaming XHR boundary are controlled.
 */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const PARTIAL_REPLY = 'The remote server started this answer';
const RECOVERED_REPLY = 'The remote server is available again.';
const DISCONNECTING_STREAM =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  `data: {"choices":[{"delta":{"content":"${PARTIAL_REPLY}"}}]}\n\n` +
  '__PAUSE__\n' +
  '__NETWORK_ERROR__\n';
const RECOVERY_STREAM =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  `data: {"choices":[{"delta":{"content":"${RECOVERED_REPLY}"}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('P1 #145 full-App remote disconnect recovery', () => {
  it('preserves a partial response and accepts a new turn after the server returns', async () => {
    installRemoteDiscoveryBoundary();
    const { rtl, view } = await renderMainApp();
    await openRemoteChatThroughApp(rtl, view);

    const disconnectingStream = installRemoteStream(DISCONNECTING_STREAM);
    sendChatMessage(rtl, view, 'Give me a detailed status update.');

    // Anti-false-green: prove the real remote turn is visibly in flight before disconnecting it.
    await rtl.waitFor(
      () => {
        expect(view.getByText(PARTIAL_REPLY)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 6000 },
    );

    disconnectingStream.release();
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(PARTIAL_REPLY)).toHaveLength(1);
        expect(view.getByText('Network error')).toBeTruthy();
        expect(view.getByText('Generation Error')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 6000 },
    );

    // The error is recoverable, not a dead-end: dismiss it, restore the boundary, and send normally.
    rtl.fireEvent.press(view.getByText('OK'));
    installRemoteStream(RECOVERY_STREAM);
    sendChatMessage(rtl, view, 'Try the request again now.');

    await rtl.waitFor(
      () => {
        expect(view.getAllByText(RECOVERED_REPLY)).toHaveLength(1);
        expect(view.getAllByText(PARTIAL_REPLY)).toHaveLength(1);
        expect(view.getAllByText('Network error')).toHaveLength(1);
        expect(view.queryByText('Generation Error')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 6000 },
    );

    view.unmount();
  }, 30000);
});
