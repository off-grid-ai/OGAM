/** P1 #47 — retrying an assistant reply replaces that turn's downstream branch once. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  if (value && typeof value === 'object' && 'children' in value)
    return renderedText((value as { children: unknown[] }).children);
  return '';
}

describe('P1 full-App regenerate reply journey', () => {
  it('replaces the selected reply and its downstream branch with one regenerated response', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor, within } = rtl;
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({ text: 'Original first answer.' });
    sendChatMessage(rtl, view, 'first question');
    await waitFor(() =>
      expect(view.getByText('Original first answer.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({ text: 'Original follow-up answer.' });
    sendChatMessage(rtl, view, 'follow-up question');
    await waitFor(() =>
      expect(view.getByText('Original follow-up answer.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'Regenerated first answer, with a better explanation.',
      pauseAfter: 'Regenerated first answer',
    });
    fireEvent(view.getAllByTestId('assistant-message')[0], 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-retry')));

    await waitFor(() => {
      expect(view.getByText(/Regenerated first answer/)).toBeTruthy();
      expect(view.getByTestId('stop-button')).toBeTruthy();
      expect(view.queryByText('Original first answer.')).toBeNull();
      expect(view.queryByText('follow-up question')).toBeNull();
      expect(view.queryByText('Original follow-up answer.')).toBeNull();
    });

    boundary.llama!.releaseStream();
    await waitFor(
      () => {
        const chat = view.getByTestId('chat-screen');
        const messageTexts = within(chat)
          .getAllByTestId('message-text')
          .map(renderedText);
        expect(messageTexts).toHaveLength(2);
        expect(messageTexts[0]).toContain('first question');
        expect(messageTexts[1]).toContain(
          'Regenerated first answer, with a better explanation.',
        );
        expect(
          within(chat).getAllByText(
            'Regenerated first answer, with a better explanation.',
          ),
        ).toHaveLength(1);
        expect(view.queryByText('Original first answer.')).toBeNull();
        expect(view.queryByText('follow-up question')).toBeNull();
        expect(view.queryByText('Original follow-up answer.')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    expect(
      within(view.getByTestId('chat-screen')).getAllByText(
        'Regenerated first answer, with a better explanation.',
      ),
    ).toHaveLength(1);

    fireEvent.changeText(view.getByTestId('chat-input'), 'ready for next turn');
    await waitFor(() => {
      expect(view.getByTestId('chat-input').props.value).toBe(
        'ready for next turn',
      );
      expect(view.getByTestId('send-button')).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
    });
    view.unmount();
  }, 30000);
});
