/**
 * T035 / Q6 (checklist Area 4, full-UI upgrade) — the thinking-box header must read "Thinking..." WHILE the
 * reasoning is still streaming (separate reasoning channel: litert/remote). Device (Q6): on litert/remote it
 * reads the DONE label ("Thought process") while reasoning is still coming — because for a separate channel
 * the message CONTENT is empty, and parseMessageContent('') returns isThinkingComplete=true (no open <think>
 * to keep it "in progress"), so the header flips to done prematurely. llama's inline <think> is correct (its
 * open tag keeps isThinkingComplete=false).
 *
 * Real transport: a captured-shape Ollama NDJSON whose reasoning streams (message.thinking, ungated → shown),
 * then PAUSES mid-stream (before any content) via the harness __PAUSE__ marker, so we can read the header at
 * the exact moment the user sees "still thinking".
 *
 * RED (Q6): while the streaming-thinking-hint is on screen (reasoning still streaming), the header reads
 * "Thought process", not "Thinking...". Falsify/spec: it should read "Thinking..." mid-stream.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// Ollama native /api/chat NDJSON: reasoning streams in message.thinking (ungated → shown), PAUSE mid-stream
// (no content yet), then the answer, then done.
const OLLAMA_PAUSED =
  '{"message":{"role":"assistant","thinking":"Reasoning Trace: 6 times 7"}}\n' +
  '{"message":{"role":"assistant","thinking":" — let me work it out,"}}\n' +
  '__PAUSE__\n' +
  '{"message":{"role":"assistant","content":"The answer is 42."}}\n' +
  '{"message":{"role":"assistant","content":""},"done":true}\n';

describe('T035 (rendered) — thinking-box header while reasoning still streams (Q6)', () => {
  it('reads "Thinking..." while the reasoning is still streaming (RED: reads the DONE label)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    await installRemoteModel({ name: 'Ollama', endpoint: 'http://localhost:11434', caps: { supportsThinking: false } });
    const stream = installRemoteStream(OLLAMA_PAUSED);
    h.render();

    await h.tapSend('what is 6 times 7');

    // Mid-stream (paused): the thinking block is on screen and the reasoning is still streaming.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('streaming-thinking-hint')).not.toBeNull(); }, { timeout: 6000 });
    // SPEC: the header reads "Thinking..." while still streaming. RED (Q6): it reads "Thought process".
    expect(String(h.view!.getByTestId('thinking-block-title').props.children)).toMatch(/Thinking/);

    stream.release(); // let the turn finish so the test tears down cleanly
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 42/)).not.toBeNull(); }, { timeout: 6000 });
  });
});
