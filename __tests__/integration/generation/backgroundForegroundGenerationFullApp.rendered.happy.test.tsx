/** P1 #172 — backgrounding and foregrounding during a local turn preserves one coherent generation. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROMPT = 'Keep this turn coherent while the app backgrounds.';
const PARTIAL = 'The answer remains attached to this conversation';
const REPLY = `${PARTIAL} and completes after the app returns.`;

describe('P1 #172 background to foreground during generation', () => {
  it('keeps the visible partial and completes the same turn without a stuck control', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({ text: REPLY, pauseAfter: PARTIAL });
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        expect(view.getByText(PARTIAL)).toBeTruthy();
        expect(view.getByTestId('stop-button')).toBeTruthy();
      },
      { timeout: 8000 },
    );

    await rtl.act(async () => {
      boundary.emitAppStateChange('background');
      boundary.emitAppStateChange('active');
      boundary.llama!.releaseStream();
    });

    await rtl.waitFor(
      () => {
        expect(view.getByText(REPLY)).toBeTruthy();
        expect(view.getAllByText(PROMPT).length).toBeGreaterThan(0);
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.getByTestId('chat-input').props.editable).toBe(true);
      },
      { timeout: 8000 },
    );

    expect(boundary.llama!.calls.completion).toHaveLength(1);
    view.unmount();
  }, 30000);
});
