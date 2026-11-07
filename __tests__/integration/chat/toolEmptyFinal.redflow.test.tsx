/**
 * UI regression: a successful tool + an empty final turn must not expose raw tool output as the
 * assistant answer.
 *
 * Fully UI-driven: the calculator is enabled by flipping its real Switch on the Tools screen (arrive-via-UI,
 * not settings-seeding), then the user types a question into the REAL ChatScreen input and taps send. The
 * REAL generationToolLoop runs the REAL calculator over the faked-native tool-call, and the model's final
 * turn is EMPTY.
 *
 * The raw result remains available inside Work done. Only the native LiteRT leaf is faked.
 */
import { within } from '@testing-library/react-native';
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Q5 (behavioral) — successful tool + empty final turn', () => {
  it('keeps raw tool output inside Work done instead of using it as the answer', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableToolViaUI('calculator'); // real Tools-screen toggle
    h.render();

    // The model emits a calculator tool call, the tool returns data, but the final turn is EMPTY.
    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: '' });

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Work done')).not.toBeNull();
    });
    const answerBubble = h.view!.getAllByTestId('message-bubble').at(-1)!;
    expect(within(answerBubble).queryByText('2+2 = 4')).toBeNull();

    const work = h.view!.getByTestId('assistant-work-toggle');
    if (work.props.accessibilityState?.expanded !== true) {
      h.rtl.fireEvent.press(work);
    }
    expect(h.view!.getAllByTestId('tool-result-label-calculator').length).toBeGreaterThan(0);
  });

  it('control: when the model DOES answer after the tool, the user sees the answer (no "(No response)")', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableToolViaUI('calculator');
    h.render();

    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 4\./)).not.toBeNull(); });
    expect(h.view!.queryByText(/\(No response\)/)).toBeNull();
  });
});
