/** P2 #41 — a local reply that reaches its output-token cap must not look complete. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 full-app long output cutoff', () => {
  it('shows visible retry guidance when native generation stops at the token limit', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletions([
      { text: 'This short answer is complete.' },
      {
        text: 'Once upon a time there was a village beside the sea and',
        completionMeta: {
          stopped_eos: false,
          stopped_limit: 1,
          tokens_predicted: 1024,
        },
      },
    ]);
    await openChatWithJourneyModel(rtl, view);

    sendChatMessage(rtl, view, 'Give me a short answer');
    await rtl.waitFor(() =>
      expect(view.getByText('This short answer is complete.')).toBeTruthy(),
    );
    expect(view.queryByTestId('message-cutoff-indicator')).toBeNull();

    sendChatMessage(rtl, view, 'Write a very long story');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText(
            'Once upon a time there was a village beside the sea and',
          ),
        ).toBeTruthy();
        expect(view.getByTestId('message-cutoff-indicator')).toBeTruthy();
        expect(
          view.getByText(
            'Reply cut off at the token limit. Retry to continue.',
          ),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 6000 },
    );
    view.unmount();
  }, 30000);
});
