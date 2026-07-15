/**
 * RED-FLOW (UI, BEHAVIORAL) — Q2: a llama tool call with unquoted-key JSON is dropped, so the user sees no
 * tool-result bubble (the tool silently never ran).
 *
 * Fully UI-driven: enable the calculator via its real Switch on the Tools screen (arrive-via-UI), then type
 * a question into the REAL ChatScreen and tap send. The REAL generationToolLoop parses the model's
 * completion text; the tool call uses an UNQUOTED key (`{expression: "2+2"}`) which the parser drops → the
 * calculator never runs → no tool-result bubble. Only the native llama leaf is faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Q2 (behavioral) — unquoted-key tool call renders no result bubble', () => {
  it('renders a calculator tool-result bubble even when the model emits an unquoted key', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.enableToolViaUI('calculator');
    h.render();

    // The model emits its visible reply "Calculating." plus a tool call with an UNQUOTED key in arguments.
    await h.send('what is 2 + 2', { text: 'Calculating. <tool_call>{"name": "calculator", "arguments": {expression: "2+2"}}</tool_call>' });

    // Wait on a USER-VISIBLE signal that the turn finished: the model's reply text "Calculating." appears on
    // screen. (We can't "wait for absence"; we wait for the turn to complete, then assert the tool bubble.)
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Calculating\./)).not.toBeNull(); });
    await h.settle(); // let the tool loop finish after the visible reply
    // Correct: the calculator ran, so its result bubble is shown. Today the unquoted-key call is dropped by
    // the parser → the tool never runs → no tool-result bubble → RED. (A quoted key DOES render it — the
    // falsification control confirms this same assertion passes when the key is quoted.)
    expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull();
  });
});
