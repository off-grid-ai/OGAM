/** P0 #42/#43 — terminal recovery for failed and user-stopped GGUF turns through the real App. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const PARTIAL = 'The capital of France is Paris and it';

describe('P0 core generation recovery journeys', () => {
  it('clears the generating control and shows the error after a GGUF runtime failure', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    boundary.llama!.scriptCompletion({
      text: 'Looking at the image',
      pauseAfter: 'Loo',
      throwAfter: 'Failed to evaluate chunks',
    });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'describe this image');
    await rtl.waitFor(() => {
      expect(view.getAllByText('describe this image').length).toBeGreaterThan(
        0,
      );
      expect(view.getByTestId('stop-button')).toBeTruthy();
    });

    boundary.llama!.releaseStream();
    await rtl.waitFor(
      () => {
        expect(view.getByText('Failed to evaluate chunks')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 6000 },
    );
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'retry prompt');
    await rtl.waitFor(() =>
      expect(view.getByTestId('send-button')).toBeTruthy(),
    );
    view.unmount();
  });

  it('keeps the rendered partial after the user stops a GGUF turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    boundary.llama!.scriptCompletion({
      text: `${PARTIAL} sits on the Seine.`,
      pauseAfter: PARTIAL,
    });

    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'what is the capital of France?');
    await rtl.waitFor(() => {
      expect(view.getByText(new RegExp(PARTIAL))).toBeTruthy();
      expect(view.getByTestId('stop-button')).toBeTruthy();
    });

    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByTestId('stop-button'));
    });
    await rtl.waitFor(() => {
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.getByText(new RegExp(PARTIAL))).toBeTruthy();
    });
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'follow up');
    await rtl.waitFor(() =>
      expect(view.getByTestId('send-button')).toBeTruthy(),
    );
    view.unmount();
  });
});
