/**
 * RED-FLOW (UI, BEHAVIORAL) — Q3: a tool call whose `arguments` is a STRINGIFIED JSON payload (a string,
 * not an object) breaks the calculator, so the tool-result bubble the user sees shows an internal error
 * instead of the answer (4).
 *
 * Fully UI-driven: enable calculator via the real Tools-screen Switch (arrive-via-UI), type + tap send on
 * the real ChatScreen (llama). Only the native llama leaf is faked. Unlike Q2 (dropped call), here the tool
 * RUNS but with bad args → the rendered bubble shows a failure.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Q3 (behavioral) — stringified tool args surface an error bubble', () => {
  it('shows the computed answer in the tool bubble, not an internal error', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.enableToolViaUI('calculator');
    h.render();

    // `arguments` is a STRING ("{\"expression\":\"2+2\"}") rather than an object.
    await h.send('what is 2 + 2', { text: 'Calculating. <tool_call>{"name": "calculator", "arguments": "{\\"expression\\": \\"2+2\\"}"}</tool_call>' });

    // Wait on the completed work control, then inspect the tool result it contains.
    await h.rtl.waitFor(() => {
      expect(h.view!.getByTestId('assistant-work-toggle').props.accessibilityLabel).toBe('Work done');
    });
    await h.settle();
    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));

    // The tool ran and produced a result bubble...
    expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull();
    // ...which must show the computed answer, NOT an internal failure. Today the stringified args break the
    // calculator so the bubble shows a failure → RED.
    expect(h.view!.queryByText(/failed \(internal\)|Cannot read properties|error/i)).toBeNull();
  });
});
