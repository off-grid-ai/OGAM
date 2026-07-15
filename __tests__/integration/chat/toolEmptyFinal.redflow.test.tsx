/**
 * RED-FLOW (UI, BEHAVIORAL) — Q5: a successful tool + an empty final turn shows "(No response)".
 *
 * Fully UI-driven: the calculator is enabled by flipping its real Switch on the Tools screen (arrive-via-UI,
 * not settings-seeding), then the user types a question into the REAL ChatScreen input and taps send. The
 * REAL generationToolLoop runs the REAL calculator over the faked-native tool-call, and the model's final
 * turn is EMPTY.
 *
 * IMPORTANT (what UI-driven testing revealed): the service-level version of this bug asserted the literal
 * "(No response)" fallback string — but through the REAL ChatScreen streaming path the user NEVER sees that
 * string. The real symptom is that the assistant's answer bubble is EMPTY (content ''), so the user gets a
 * blank reply with no synthesized answer. The correct behavior is a visible assistant answer built from the
 * tool result. We assert the real, user-observable symptom (an assistant answer bubble is rendered) → RED
 * today because the assistant message is empty. Only the native LiteRT leaf is faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Q5 (behavioral) — successful tool + empty final turn', () => {
  it('does NOT leave the user on a dead-end "(No response)" when a tool returned data', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableToolViaUI('calculator'); // real Tools-screen toggle
    h.render();

    // The model emits a calculator tool call, the tool returns data, but the final turn is EMPTY.
    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: '' });

    // The tool ran (its result bubble is shown)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull(); });

    // ...but the user's reply is BLANK. The active conversation's assistant message content is the empty
    // string — the model never synthesized an answer from the tool result the user can read. Correct: a
    // non-empty assistant answer. Today it is '' → RED. (This is the REAL UI symptom; the service-level
    // "(No response)" string is never rendered through the streaming ChatScreen path.)
    const conv = h.useChatStore.getState().conversations.find((c: { id: string }) => c.id === h.useChatStore.getState().activeConversationId);
    const assistant = [...conv.messages].reverse().find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect((assistant.content as string).trim().length).toBeGreaterThan(0);
  });

  it('control: when the model DOES answer after the tool, the user sees the answer (no "(No response)")', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableToolViaUI('calculator');
    h.render();

    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 4\./)).not.toBeNull(); });
    expect(h.view!.queryByText(/\(No response\)/)).toBeNull();
  });
});
