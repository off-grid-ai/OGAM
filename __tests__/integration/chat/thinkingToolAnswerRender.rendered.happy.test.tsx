/**
 * T038 (checklist Area 4, full-UI upgrade) — thinking + tool + answer all render together in one turn.
 * Device-grounded (DEVICE_SESSION_COMMENTARY:49 "thinking was on, it reasoned, and then used the calculator
 * tool, and then give the answer"; :51 the 128*256 prompt "showed both the pre-tool call thinking + tool call
 * + post tool call thinking + message"). The prior coverage (thinkingAcrossToolCall) renders a constructed
 * ChatMessage component; this drives the FULL ChatScreen with a real send gesture.
 *
 * Real stack: mount ChatScreen, enable the calculator on the real Tools screen, send a reason-then-compute
 * prompt; the litert fake streams reasoning → a calculator tool_call → the answer. Assert the user sees all
 * three: the reasoning in the thinking block, the tool-result bubble, and the final answer.
 *
 * Falsify: drop the reasoning from the scripted turn → the thinking block has no content → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T038 (rendered) — thinking + tool-result + answer all render in a reason→tool→answer turn', () => {
  it('shows the reasoning in the thinking block, the tool-result bubble, and the final answer', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.enableToolViaUI('calculator'); // real Tools-screen switch
    h.render();
    // Precondition via a REAL gesture (not updateSettings): open the composer quick-settings and flip Thinking on.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-thinking-toggle')));

    // The litert model reasons, calls the calculator (128*256), then answers (the device 128*256 prompt).
    await h.send('reason about it then compute 128*256', {
      reasoning: 'I should multiply 128 by 256 using the calculator.',
      toolCalls: [{ name: 'calculator', arguments: { expression: '128*256' } }],
      content: 'The answer is 32768.',
    });

    // The user sees all three: the thinking block renders — tap it (real gesture) to expand and read the
    // reasoning it captured.
    const toggle = await h.rtl.waitFor(() => h.view!.getByTestId('thinking-block-toggle'), { timeout: 4000 });
    h.rtl.fireEvent.press(toggle);
    // The expanded thinking block shows the reasoning as rendered text.
    await h.rtl.waitFor(() => {
      expect(h.rtl.within(h.view!.getByTestId('thinking-block-content')).queryByText(/multiply 128 by 256/)).not.toBeNull();
    }, { timeout: 4000 });
    // ...the tool-result bubble (the calculator actually ran)...
    expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull();
    // ...and the final answer.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 32768\./)).not.toBeNull(); });
  });
});
