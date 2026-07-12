/**
 * T051 / DEV — a remote OLLAMA reasoning model renders its thinking (the contrast to LM Studio / T049).
 *
 * Ground truth (docs/wire-captures/ollama-raw-curl-proof-…-part10 + user-confirmed correction): Ollama's
 * native /api/chat streams the reasoning in a `message.thinking` field, and the app's Ollama path
 * (handleOllamaChatLine) routes it to onReasoning UNCONDITIONALLY (no thinkingEnabled gate) — so on device
 * Ollama's thinking RENDERED (reasoning=211, user saw it on screen). This is the exact opposite of the
 * OpenAI-compat LM Studio path (T049), which gates reasoning_content on thinkingEnabled and DROPS it.
 *
 * Real transport: the captured Ollama NDJSON is replayed at the XMLHttpRequest boundary (endpoint :11434 →
 * the native Ollama path). SPEC + device: the thinking renders. GREEN happy guard.
 *
 * Falsifiable: if the Ollama path stopped routing message.thinking to onReasoning, the thinking would
 * vanish and this goes red — proving it tracks the real render, not a mock.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// Captured Ollama native /api/chat NDJSON: reasoning in message.thinking, then the answer, then done.
const OLLAMA_NDJSON =
  '{"message":{"role":"assistant","thinking":"Reasoning Trace: 6 times 7 is 42."}}\n' +
  '{"message":{"role":"assistant","content":"The answer is 42."}}\n' +
  '{"message":{"role":"assistant","content":""},"done":true}\n';

describe('T051 (rendered) — remote Ollama reasoning RENDERS (contrast to LM Studio T049)', () => {
  it('renders both the Ollama answer and the thinking it streamed', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // Endpoint :11434 → the native Ollama path (handleOllamaChatLine), which renders message.thinking.
    await installRemoteModel({ name: 'Ollama', endpoint: 'http://localhost:11434', caps: { supportsThinking: false } });
    installRemoteStream(OLLAMA_NDJSON);
    h.render();

    await h.tapSend('what is 6 times 7');

    // The remote answer renders (transport works)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 42/)).not.toBeNull(); }, { timeout: 6000 });
    // ...AND the thinking the model streamed renders (Ollama's native path is not gated). GREEN.
    expect(h.view!.queryByText(/Reasoning Trace/)).not.toBeNull();
  });
});
