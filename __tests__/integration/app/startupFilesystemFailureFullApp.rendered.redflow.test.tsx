/** APP-P0-003 — a transient partial filesystem-init failure cannot trap App startup. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P0 partial filesystem initialization recovery', () => {
  it('reaches usable UI, retries from Models, and completes a core chat turn', async () => {
    let filesystemRecovered = false;
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      waitForHome: false,
      beforeRender: ({ boundary: native }) => {
        const mkdir = native.fs!.module.mkdir as jest.Mock;
        const realMkdir = mkdir.getMockImplementation();
        mkdir.mockImplementation(async (path: string) => {
          if (!filesystemRecovered && path.endsWith('/image_models')) {
            throw new Error(
              'EIO: image model directory is temporarily unavailable',
            );
          }
          return realMkdir?.(path);
        });
      },
    });

    await rtl.waitFor(() => {
      expect(view.queryByTestId('app-loading')).toBeNull();
      expect(view.getByTestId('model-download-screen')).toBeTruthy();
      expect(view.getByText('Set Up Your AI')).toBeTruthy();
      expect(view.getByTestId('model-download-skip')).toBeTruthy();
      expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
    });

    rtl.fireEvent.press(view.getByTestId('model-download-skip'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('home-screen')).toBeTruthy();
      expect(view.queryByTestId('model-download-screen')).toBeNull();
      expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
    });

    filesystemRecovered = true;
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-screen')).toBeTruthy();
      expect(view.getByText('Text Models')).toBeTruthy();
      expect(view.getByTestId('import-local-model')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('home-screen')).toBeTruthy();
      expect(view.getByTestId('model-summary-count-text')).toHaveTextContent(
        '1',
      );
    });
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'Core chat recovered after storage became available.',
    });
    sendChatMessage(rtl, view, 'Confirm the app recovered');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('Core chat recovered after storage became available.'),
        ).toBeTruthy();
        expect(view.queryByTestId('error-boundary-fallback')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );
    view.unmount();
  }, 30000);
});
