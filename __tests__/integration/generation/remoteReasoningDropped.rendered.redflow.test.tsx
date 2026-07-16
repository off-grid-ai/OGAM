/**
 * T049 / DEV-B16 — a remote (LM Studio) reasoning model SENDS reasoning_content, but the app doesn't render
 * the thinking — it's silently dropped. Coming-through-fine-but-not-shown = a UI bug.
 *
 * Ground truth (docs/wire-captures/lmstudio-raw-curl-proof-…-part8 + [WIRE-REMOTE]): LM Studio streams
 *   delta {"reasoning_content":"Thinking Process:…"}  (raw-curl proof)
 * but [Provider][DEBUG] reasoning=0 — the app ACCUMULATED ZERO reasoning. Cause: no thinking toggle for
 * remote → thinkingEnabled=false → processDelta gates reasoning_content on thinkingEnabled → DISCARDED.
 * User: "LM Studio exposes it, the app doesn't surface it" / "when it's coming properly and you're not
 * showing it in the UI, it's a UI bug."
 *
 * Real transport: the CAPTURED LM Studio SSE is replayed at the XMLHttpRequest boundary; the REAL provider,
 * processDelta and chat render run on top. SPEC: the reasoning the model sent renders in the thinking block.
 * RED on HEAD (B16): the answer renders but the reasoning is nowhere on screen (dropped).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// The captured LM Studio streaming shape: reasoning_content deltas, then the answer, then stop.
const LM_STUDIO_SSE =
  'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"\\n"}}]}\n\n' +
  'data: {"choices":[{"delta":{"reasoning_content":"Thinking Process: 6 times 7 is 42."}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"The answer is 42."}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('T049 (rendered) — remote LM Studio reasoning is dropped, not shown (DEV-B16)', () => {
  it('renders the answer but NOT the reasoning the remote model streamed', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // LM Studio (like Ollama) does NOT advertise a thinking capability → no thinking toggle for remote.
    await installRemoteModel({ name: 'LM Studio', caps: { supportsThinking: false } });
    installRemoteStream(LM_STUDIO_SSE);
    h.render();

    await h.tapSend('what is 6 times 7');

    // The remote answer arrives (proves the remote send + transport ran).
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 42/)).not.toBeNull(); }, { timeout: 6000 });

    // SPEC: the reasoning the model actually sent is shown to the user (in the thinking block).
    // RED (B16): it was gated out by thinkingEnabled=false and never renders anywhere.
    expect(h.view!.queryByText(/Thinking Process/)).not.toBeNull();
  });
});
