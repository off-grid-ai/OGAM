/** P1 #142 — LM Studio reasoning remains visible through a real full-App remote chat. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const PARTIAL_REASONING = 'Thinking remotely about the privacy question.';
const FULL_REASONING =
  'Thinking remotely about the privacy question. The model has enough context to answer.';
const ANSWER = 'On-device processing can keep private data local.';
const REASONING_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  `data: {"choices":[{"delta":{"reasoning_content":"${PARTIAL_REASONING}"}}]}\n\n` +
  '__PAUSE__\n' +
  'data: {"choices":[{"delta":{"reasoning_content":" The model has enough context to answer."}}]}\n\n' +
  `data: {"choices":[{"delta":{"content":"${ANSWER}"}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('P1 full-App LM Studio reasoning journey', () => {
  it('shows dedicated remote reasoning during and after the streamed answer', async () => {
    installRemoteDiscoveryBoundary();
    const { rtl, view } = await renderMainApp();
    await openRemoteChatThroughApp(rtl, view);

    const stream = installRemoteStream(REASONING_SSE);
    sendChatMessage(
      rtl,
      view,
      'Explain how on-device processing protects privacy.',
    );

    await rtl.waitFor(
      () => {
        expect(view.getByTestId('thinking-block')).toBeTruthy();
        expect(view.getByTestId('thinking-block-title')).toHaveTextContent(
          /Thinking/,
        );
        expect(view.getByText(PARTIAL_REASONING)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 6000 },
    );

    stream.release();
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(view.getByTestId('thinking-block-title')).toHaveTextContent(
          'Thought process',
        );
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(
          view.queryByText(/data:|reasoning_content|\[DONE\]|choices/),
        ).toBeNull();
      },
      { timeout: 6000 },
    );

    if (view.queryByTestId('thinking-block-content') === null) {
      rtl.fireEvent.press(view.getByTestId('thinking-block-toggle'));
    }
    await rtl.waitFor(() =>
      expect(view.getByText(FULL_REASONING)).toBeTruthy(),
    );

    view.unmount();
  }, 30000);
});
