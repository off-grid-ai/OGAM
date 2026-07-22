/** P1 #174 automated portion — local GGUF chat remains usable when every network request fails. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 #174 local-only chat with no network', () => {
  it('loads the downloaded model and renders its reply while transport is offline', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;

    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'This answer was generated entirely on the device.',
    });
    sendChatMessage(rtl, view, 'Can you answer without a network?');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('This answer was generated entirely on the device.'),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
        expect(view.queryByText(/Network request failed/)).toBeNull();
      },
      { timeout: 8000 },
    );

    expect(boundary.llama!.calls.completion).toHaveLength(1);
    view.unmount();
  }, 30000);
});
