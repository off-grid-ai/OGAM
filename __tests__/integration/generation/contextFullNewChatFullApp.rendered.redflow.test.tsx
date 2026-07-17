/** P2 #50 — a native context-limit failure offers a clean continuation chat. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 context-full new-chat journey', () => {
  it('shows the context-limit prompt and opens an empty chat when accepted', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { act, fireEvent, waitFor } = rtl;

    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      throwMessage: 'the input prompt is too long for this context window',
    });
    sendChatMessage(rtl, view, 'continue our very long conversation');

    await waitFor(() =>
      expect(view.getByText('Context window full')).toBeTruthy(),
    );
    expect(
      view.getByText(
        "The conversation is too long for this model's context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.",
      ),
    ).toBeTruthy();
    expect(view.getByText('New chat')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText('New chat'));
    });

    await waitFor(() =>
      expect(view.getByText('Start a Conversation')).toBeTruthy(),
    );
    expect(view.getByText('New Conversation')).toBeTruthy();
    expect(view.queryByText('continue our very long conversation')).toBeNull();
    expect(view.getByTestId('chat-input')).toHaveProp('value', '');
    expect(view.queryByText('Context window full')).toBeNull();

    view.unmount();
  }, 30000);
});
