/** Full-App message action journeys reached through rendered chat gestures. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('full-app message actions', () => {
  it('copies a visible assistant reply through its action sheet', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor } = rtl;
    const { Clipboard } = require('react-native') as {
      Clipboard: { setString(value: string): void };
    };
    let clipboardText = '';
    Clipboard.setString = value => {
      clipboardText = value;
    };

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'This reply should be copied exactly.',
    });
    sendChatMessage(rtl, view, 'Give me a short answer');
    await waitFor(() =>
      expect(
        view.getByText('This reply should be copied exactly.'),
      ).toBeTruthy(),
    );

    fireEvent(view.getByTestId('assistant-message'), 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-copy')));
    await waitFor(() => {
      expect(view.getByText('Message copied to clipboard')).toBeTruthy();
      expect(clipboardText).toBe('This reply should be copied exactly.');
    });
    view.unmount();
  });

  it('edits a user message and replaces its downstream reply', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor } = rtl;
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'The capital of Spain is Madrid.',
    });
    sendChatMessage(rtl, view, 'what is the capital of span');
    await waitFor(() =>
      expect(view.getByText('The capital of Spain is Madrid.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'Madrid is the capital of Spain.',
    });
    fireEvent(view.getByTestId('user-message'), 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-edit')));
    const editInput = await waitFor(() =>
      view.getByPlaceholderText('Enter message...'),
    );
    fireEvent.changeText(editInput, 'what is the capital of Spain');
    fireEvent.press(view.getByText('SAVE & RESEND'));

    await waitFor(() => {
      expect(
        view.getAllByText('what is the capital of Spain').length,
      ).toBeGreaterThan(0);
      expect(view.getByText('Madrid is the capital of Spain.')).toBeTruthy();
      expect(view.queryByText('The capital of Spain is Madrid.')).toBeNull();
    });
    view.unmount();
  });

  it('regenerates an assistant reply through its action sheet', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { fireEvent, waitFor } = rtl;
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'Honey never spoils.' });
    sendChatMessage(rtl, view, 'tell me a fact');
    await waitFor(() =>
      expect(view.getByText('Honey never spoils.')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'Octopuses have three hearts.',
    });
    fireEvent(view.getByTestId('assistant-message'), 'longPress');
    fireEvent.press(await waitFor(() => view.getByTestId('action-retry')));
    await waitFor(() => {
      expect(view.getByText('Octopuses have three hearts.')).toBeTruthy();
      expect(view.queryByText('Honey never spoils.')).toBeNull();
    });
    view.unmount();
  });
});
