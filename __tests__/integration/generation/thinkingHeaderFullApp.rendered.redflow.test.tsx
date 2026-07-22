/** P2 #40 — an in-flight reasoning block must say Thinking until the answer is complete. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const REASONING = 'First, I should multiply six by seven carefully.';

describe('P2 full-app thinking header', () => {
  it('reads Thinking while reasoning streams, then settles to the completed state', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({ text: 'The model is ready.' });
    sendChatMessage(rtl, view, 'Get ready to reason');
    await rtl.waitFor(() =>
      expect(view.getByText('The model is ready.')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-thinking-toggle')),
    );

    boundary.llama!.scriptCompletion({
      text: 'The answer is 42.',
      thinkingText: `<think>${REASONING}</think>The answer is 42.`,
      pauseAfter: 'multiply six by seven',
    });
    sendChatMessage(rtl, view, 'What is six times seven?');

    try {
      await rtl.waitFor(
        () => {
          expect(view.getByTestId('streaming-thinking-hint')).toBeTruthy();
          expect(view.getByTestId('thinking-block-title')).toHaveTextContent(
            /Thinking/,
          );
          expect(view.getByTestId('thinking-block-content')).toHaveTextContent(
            /multiply six by seven/,
          );
          expect(view.queryByText('The answer is 42.')).toBeNull();
          expect(view.getByTestId('stop-button')).toBeTruthy();
        },
        { timeout: 6000 },
      );
    } finally {
      boundary.llama!.releaseStream();
    }
    await rtl.waitFor(
      () => {
        expect(view.getByText('The answer is 42.')).toBeTruthy();
        expect(view.getByTestId('thinking-block-title')).toHaveTextContent(
          'Thought process',
        );
        expect(view.queryByTestId('streaming-thinking-hint')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 6000 },
    );
    view.unmount();
  }, 30000);
});
