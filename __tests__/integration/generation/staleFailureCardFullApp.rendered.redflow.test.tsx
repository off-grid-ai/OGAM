/** P1 #193 — a failed GGUF turn must not leave its failure card beside the next live turn. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 full-app stale generation failure recovery', () => {
  it('clears the previous no-response card when the user starts another turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletions([
      { text: '' },
      {
        text: 'Fresh reply after the failure.',
        pauseAfter: 'Fresh',
      },
    ]);
    await openChatWithJourneyModel(rtl, view);

    sendChatMessage(rtl, view, 'why is the sky blue?');
    await rtl.waitFor(
      () => {
        expect(view.getByTestId('model-failure-text')).toBeTruthy();
        expect(view.getByText('No response')).toBeTruthy();
      },
      { timeout: 6000 },
    );

    try {
      sendChatMessage(rtl, view, 'try again please');
      await rtl.waitFor(
        () => {
          expect(view.getByTestId('stop-button')).toBeTruthy();
          expect(view.getByText('Fresh')).toBeTruthy();
          expect(view.queryByTestId('model-failure-text')).toBeNull();
          expect(view.queryByText('No response')).toBeNull();
        },
        { timeout: 6000 },
      );
    } finally {
      boundary.llama!.releaseStream();
    }

    await rtl.waitFor(
      () => {
        expect(view.getByText('Fresh reply after the failure.')).toBeTruthy();
        expect(view.queryByTestId('model-failure-text')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 6000 },
    );
    view.unmount();
  }, 30000);
});
