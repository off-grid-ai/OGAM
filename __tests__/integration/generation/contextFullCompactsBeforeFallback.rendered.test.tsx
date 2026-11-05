import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('context full in a tool-enabled chat', () => {
  it('retries after compaction on the selected model without a model-change notice', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', backupModel: true });
    h.enableToolViaUI('calculator');
    h.enableGenerationDetailsViaUI();
    h.render();

    // The native engine reports a full context for the first attempt. The next native
    // completion can answer after the app clears and compacts its context.
    h.boundary.llama!.scriptCompletions([
      { completionMeta: { context_full: true } },
      { text: 'Answer from selected model.' },
    ]);
    await h.tapSend('Hi');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Answer from selected model.')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByTestId('tool-result-label-model_fallback')).toBeNull();
    const answerMessage = h.view!.getAllByTestId('assistant-message').find(
      message => h.rtl.within(message).queryByText('Answer from selected model.') !== null,
    );
    expect(answerMessage).toBeDefined();
    h.rtl.fireEvent.press(h.rtl.within(answerMessage!).getByText('Generation details'));
    expect(h.rtl.within(h.view!.getAllByTestId('generation-meta').at(-1)!).queryByText('Test Model')).not.toBeNull();
  });

  it('keeps reasoning already shown when a full context starts a retry', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.render();
    h.rtl.fireEvent.press(h.view!.getByTestId('quick-settings-button'));
    h.rtl.fireEvent.press(h.view!.getByTestId('quick-thinking-toggle'));
    h.boundary.llama!.scriptCompletions([
      { reasoning: 'I was working through the first attempt.', completionMeta: { context_full: true } },
      { text: 'Answer after compaction.' },
    ]);
    await h.tapSend('Hi');

    await h.rtl.waitFor(() => expect(h.view!.queryByText('Answer after compaction.')).not.toBeNull());
    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
    const firstThought = h.view!.getAllByTestId('thinking-block')[0];
    h.rtl.fireEvent.press(h.rtl.within(firstThought).getByTestId('thinking-block-toggle'));
    expect(h.rtl.within(firstThought).getByTestId('thinking-block-content'))
      .toHaveTextContent('I was working through the first attempt.');
  });

  it('shows a context limit after the retry also fills, and ends the busy state', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', backupModel: true });
    h.enableToolViaUI('calculator');
    h.render();
    h.boundary.llama!.scriptCompletions([
      { completionMeta: { context_full: true } },
      { completionMeta: { context_full: true } },
    ]);
    await h.tapSend('Hi');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Context window full')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.getByText(/A new chat can also hit this limit/)).toBeTruthy();
    expect(h.view!.getByText(/Max Tokens only limits the reply/)).toBeTruthy();
    expect(h.view!.queryByText('No response')).toBeNull();
    expect(h.view!.queryByTestId('tool-result-label-model_fallback')).toBeNull();
    expect(h.view!.queryByTestId('stop-button')).toBeNull();
    h.rtl.fireEvent.press(h.view!.getByText('Settings'));
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Chat settings')).not.toBeNull();
    }, { timeout: 3000 });
  });
});
