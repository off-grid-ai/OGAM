/** APP-P0-006 — an optional Pro native-extension load failure cannot disable core. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P0 optional Pro extension failure isolation', () => {
  it('keeps core models and chat usable when the Pro native extension fails to load', async () => {
    let extensionBoundaryFailed = false;
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      beforeRender: () => {
        const executorch = require('react-native-executorch') as {
          initExecutorch: () => void;
        };
        executorch.initExecutorch = () => {
          extensionBoundaryFailed = true;
          throw new Error('Native Pro extension is unavailable');
        };
      },
    });

    expect(extensionBoundaryFailed).toBe(true);
    await rtl.waitFor(() => {
      expect(view.getByTestId('home-screen')).toBeTruthy();
      expect(view.getByTestId('model-summary-count-text')).toHaveTextContent(
        '1',
      );
      expect(view.queryByTestId('app-loading')).toBeNull();
      expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-screen')).toBeTruthy();
      expect(view.getByText('Text Models')).toBeTruthy();
      expect(view.getByTestId('import-local-model')).toBeTruthy();
      expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
    });

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'Core chat stayed available without the Pro extension.',
    });
    sendChatMessage(rtl, view, 'Confirm core chat is available');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText(
            'Core chat stayed available without the Pro extension.',
          ),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
      },
      { timeout: 8000 },
    );
    view.unmount();
  }, 30000);
});
