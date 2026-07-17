/**
 * P1 #184 — a remote text model never co-resides with the local heavy model it replaces.
 *
 * The rendered journey loads and chats with a local model, configures and selects a remote
 * server through the real Settings/Home UI, and proves the Models residency surface no longer
 * charges RAM for local text. It then proves the remote reply is coherent and switches back to
 * local through Home, where the first send lazy-reloads the model and replies. Only device RAM,
 * llama, filesystem, and remote transport boundaries are faked.
 */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
  openTextModelPickerThroughHome,
  REMOTE_MODEL_ID,
} from '../../harness/fullAppRemoteJourney';
import { GB } from '../../harness/nativeBoundary';
import { installRemoteStream } from '../../harness/remoteHarness';

const LOCAL_FIRST_REPLY = 'The local model is loaded in memory.';
const REMOTE_REPLY = 'The remote model is active and the local memory is free.';
const LOCAL_RETURN_REPLY = 'The local model reloaded and is answering again.';
const REMOTE_REPLY_SSE =
  `data: {"choices":[{"delta":{"content":"${REMOTE_REPLY}"}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('P1 remote activation and local residency', () => {
  it('frees the local heavy model, keeps remote chat coherent, and lazy-reloads local on return', async () => {
    installRemoteDiscoveryBoundary();
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
    });

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: LOCAL_FIRST_REPLY });
    sendChatMessage(rtl, view, 'Load the local model.');
    await rtl.waitFor(
      () => expect(view.getByText(LOCAL_FIRST_REPLY)).toBeTruthy(),
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('Done'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );

    await openRemoteChatThroughApp(rtl, view);

    // Remote selection is a text-model replacement, not an extra resident. The
    // real manager sheet is the user-visible authority for what occupies RAM.
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        new RegExp(REMOTE_MODEL_ID),
      );
      expect(view.getByTestId('models-row-text-remote')).toBeTruthy();
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.queryByTestId('models-row-text-eject')).toBeNull();
    });
    rtl.fireEvent.press(view.getByText('Done'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );

    installRemoteStream(REMOTE_REPLY_SSE);
    sendChatMessage(rtl, view, 'Confirm that remote chat still works.');
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(REMOTE_REPLY)).toHaveLength(1);
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByText(/data:|\[DONE\]|choices/)).toBeNull();
      },
      { timeout: 8000 },
    );

    // Returning through Home selects local without eagerly loading it. The next
    // real send owns the lazy reload and must produce a clean local answer.
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openTextModelPickerThroughHome(rtl, view);
    const localModel = await rtl.waitFor(() => view.getByTestId('model-item'));
    rtl.fireEvent.press(localModel);
    await rtl.waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({ text: LOCAL_RETURN_REPLY });
    sendChatMessage(rtl, view, 'Answer locally again.');
    await rtl.waitFor(
      () => {
        expect(view.getByText(LOCAL_RETURN_REPLY)).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-text-remote')).toBeNull();
    });

    view.unmount();
  }, 40000);
});
