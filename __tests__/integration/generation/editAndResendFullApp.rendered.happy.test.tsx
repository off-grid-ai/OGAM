/** P1 #46 — editing a user turn replaces its downstream branch and regenerates once. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 full-App edit and resend journey', () => {
  it('replaces the edited turn branch without stale messages or loading state', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor, within } = rtl;

    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'The capital of Spain is Madrid.',
    });
    sendChatMessage(rtl, view, 'what is the capital of span');
    await waitFor(() =>
      expect(view.getByText('The capital of Spain is Madrid.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'It is known for the Prado Museum.',
    });
    sendChatMessage(rtl, view, 'what is it known for?');
    await waitFor(() =>
      expect(view.getByText('It is known for the Prado Museum.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'Lisbon is the capital of Portugal.',
    });
    fireEvent(view.getAllByTestId('user-message')[0], 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-edit')));
    const editInput = await waitFor(() =>
      view.getByPlaceholderText('Enter message...'),
    );
    fireEvent.changeText(editInput, 'what is the capital of Portugal?');
    fireEvent.press(view.getByText('SAVE & RESEND'));

    await waitFor(
      () => {
        expect(
          view.getByText('Lisbon is the capital of Portugal.'),
        ).toBeTruthy();
        const userMessages = view.getAllByTestId('user-message');
        const assistantMessages = view.getAllByTestId('assistant-message');

        expect(userMessages).toHaveLength(1);
        expect(assistantMessages).toHaveLength(1);
        expect(
          within(userMessages[0]).getAllByText(
            'what is the capital of Portugal?',
          ).length,
        ).toBeGreaterThan(0);
        expect(
          within(assistantMessages[0]).getByText(
            'Lisbon is the capital of Portugal.',
          ),
        ).toBeTruthy();

        // The first user turn owns the automatic conversation title, so editing
        // it updates both the bubble and the header instead of leaving stale history.
        expect(view.getByTestId('chat-title')).toHaveTextContent(
          'what is the capital of Portugal?',
        );

        expect(view.queryByText('what is the capital of span') === null).toBe(
          true,
        );
        expect(view.queryByText('what is it known for?') === null).toBe(true);
        expect(view.queryByText('The capital of Spain is Madrid.')).toBeNull();
        expect(
          view.queryByText('It is known for the Prado Museum.'),
        ).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
      },
      { timeout: 8000 },
    );

    view.unmount();
  }, 30000);
});
