/** P2 #50/#120 — context-limit recovery keeps a project-filed continuation. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';

const PROJECT_NAME = 'Long Context Research';

describe('P2 context-full new-chat journey', () => {
  it('shows the prompt and opens an empty continuation in the same project', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      persistedAppState: {
        activeModelId: 'test/journey-model/journey-model-Q4_K_M.gguf',
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('projects-tab'));
    fireEvent.press(await waitFor(() => view.getByText('New')));
    fireEvent.changeText(
      await waitFor(() =>
        view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
      ),
      PROJECT_NAME,
    );
    fireEvent.changeText(
      view.getByPlaceholderText(
        'Enter the instructions or context for the AI...',
      ),
      'Keep every continuation filed with this research project.',
    );
    fireEvent.press(view.getByText('Save'));
    fireEvent.press(await waitFor(() => view.getByText(PROJECT_NAME)));
    fireEvent.press(await waitFor(() => view.getByText('New')));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
    expect(
      view.getByText(`Project: ${PROJECT_NAME} — tap to change`),
    ).toBeTruthy();

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
    expect(
      view.getByText(`Project: ${PROJECT_NAME} — tap to change`),
    ).toBeTruthy();
    expect(view.queryByText('continue our very long conversation')).toBeNull();
    expect(view.getByTestId('chat-input')).toHaveProp('value', '');
    expect(view.queryByText('Context window full')).toBeNull();

    view.unmount();
  }, 30000);
});
