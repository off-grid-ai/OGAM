/**
 * RED-FLOW (UI, BEHAVIORAL) — Q2: a llama tool call with unquoted-key JSON is dropped, so the user sees no
 * tool-result bubble (the tool silently never ran).
 *
 * Fully UI-driven: enable the calculator via its real Switch on the Tools screen (arrive-via-UI), then type
 * a question into the REAL ChatScreen and tap send. The REAL generationToolLoop parses the model's
 * completion text; the tool call uses an UNQUOTED key (`{expression: "2+2"}`) which the parser drops → the
 * calculator never runs → no tool-result bubble. Only the native llama leaf is faked.
 */
import { startChatScreen, usingLlama } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Q2 (behavioral) — unquoted-key tool call renders no result bubble', () => {
  it('renders a calculator tool-result bubble even when the model emits an unquoted key', async () => {
    const h = await startChatScreen(usingLlama().withTools('built-in'));

    // The model emits its visible reply "Calculating." plus a tool call with an UNQUOTED key in arguments.
    await h.send('what is 2 + 2', {
      text: 'Calculating. <tool_call>{"name": "calculator", "arguments": {expression: "2+2"}}</tool_call>',
    });

    // The calculator ran, so the user sees its result bubble. Wait for this final
    // outcome directly; the pre-tool text can appear in more than one message.
    await h.rtl.waitFor(() => {
      expect(h.assertions.isToolCallVisible('calculator')).toBe(true);
    });
  });
});
