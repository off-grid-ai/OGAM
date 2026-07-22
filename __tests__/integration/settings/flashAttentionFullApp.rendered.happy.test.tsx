/** P2 #37 — the Flash Attention toggle reaches the native text-model load. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 full-app Flash Attention journey', () => {
  it('loads and generates with Flash Attention disabled in Settings', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('text-advanced-toggle')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('flash-attn-off-button')),
    );
    await rtl.waitFor(() => {
      expect(
        view.getByTestId('flash-attn-off-button').props.accessibilityState
          .selected,
      ).toBe(true);
    });

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    boundary.llama!.scriptCompletion({
      text: 'Flash-disabled generation completed.',
    });
    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'use the selected attention configuration');

    await rtl.waitFor(() =>
      expect(
        view.getByText('Flash-disabled generation completed.'),
      ).toBeTruthy(),
    );
    const initRequests = boundary.llama!.module.initLlama.mock.calls.map(
      call => call[0],
    );
    expect(initRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flash_attn_type: 'off' }),
      ]),
    );

    view.unmount();
  });
});
