/** P1 #84 - a non-vision model refuses image input without breaking chat. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 non-vision image refusal journey', () => {
  it('explains the model limitation and keeps the text composer usable', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('attach-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('attach-photo')),
    );

    await rtl.waitFor(() => {
      expect(view.getByText('Vision Not Supported')).toBeTruthy();
      expect(
        view.getByText(
          'This model does not support image input.\n\nSwitch to a vision-capable model to send images.',
        ),
      ).toBeTruthy();
    });
    expect(view.queryByTestId('attachments-container')).toBeNull();

    rtl.fireEvent.press(view.getByText('OK'));
    await rtl.waitFor(() =>
      expect(view.queryByText('Vision Not Supported')).toBeNull(),
    );

    boundary.llama!.scriptCompletion({ text: 'Text chat still works.' });
    sendChatMessage(rtl, view, 'Continue with text only');

    await rtl.waitFor(
      () => {
        expect(
          view.getAllByText('Continue with text only').length,
        ).toBeGreaterThan(0);
        expect(view.getByText('Text chat still works.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value ?? '').toBe('');
      },
      { timeout: 6000 },
    );

    view.unmount();
  }, 30000);
});
