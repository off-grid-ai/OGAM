/** P2 #149 — a remote text model does not inflate the local-download count. */
import { renderMainApp } from '../../harness/appJourney';

describe('P2 Home text count with a remote model', () => {
  it('shows zero local downloads while visibly marking Text active', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isModelsRequest = url.endsWith('/v1/models');
      return {
        ok: isModelsRequest,
        status: isModelsRequest ? 200 : 404,
        headers: { get: () => null },
        json: async () =>
          isModelsRequest
            ? {
                object: 'list',
                data: [
                  {
                    id: 'llama-3-8b',
                    object: 'model',
                    owned_by: 'local',
                  },
                ],
              }
            : {},
        text: async () => '',
      } as unknown as Response;
    });

    let view: Awaited<ReturnType<typeof renderMainApp>>['view'] | undefined;
    try {
      const app = await renderMainApp();
      const { rtl } = app;
      view = app.view;

      rtl.fireEvent.press(view.getByTestId('settings-tab'));
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByText('Remote Servers')),
      );
      rtl.fireEvent.press(view.getByText('Add Server'));
      rtl.fireEvent.changeText(
        await rtl.waitFor(() =>
          view!.getByPlaceholderText('e.g., Off Grid AI Desktop'),
        ),
        'My LM Studio',
      );
      rtl.fireEvent.changeText(
        view.getByPlaceholderText('http://192.168.1.50:7878'),
        'http://192.168.50.10:1234',
      );
      rtl.fireEvent.press(view.getByText('Test Connection'));

      await rtl.waitFor(
        () => expect(view!.getByText(/Connected \(/)).toBeTruthy(),
        { timeout: 5000 },
      );
      const addButtons = view.getAllByText('Add Server');
      rtl.fireEvent.press(addButtons[addButtons.length - 1]);
      await rtl.waitFor(() =>
        expect(view!.getByText('My LM Studio')).toBeTruthy(),
      );

      rtl.fireEvent.press(view.getByTestId('remote-servers-back-button'));
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByTestId('home-tab')),
      );
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByTestId('browse-models-button')),
      );
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByTestId('remote-model-item')),
      );

      // Remove the sole local download through the real Download Manager. The
      // remote selection must remain represented while the local count becomes 0.
      rtl.fireEvent.press(view.getByTestId('models-tab'));
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByTestId('downloads-icon')),
      );
      rtl.fireEvent.press(
        await rtl.waitFor(() => view!.getByTestId('delete-model-button')),
      );
      await rtl.waitFor(() =>
        expect(view!.getByText('Delete Model')).toBeTruthy(),
      );
      rtl.fireEvent.press(view.getByText('Delete'));
      await rtl.waitFor(
        () => {
          expect(view!.queryByText('journey-model-Q4_K_M.gguf')).toBeNull();
          expect(view!.getByText('No models downloaded yet')).toBeTruthy();
        },
        { timeout: 5000 },
      );

      rtl.fireEvent.press(view.getByTestId('back-button'));
      await rtl.waitFor(() =>
        expect(view!.getByTestId('models-screen')).toBeTruthy(),
      );
      rtl.fireEvent.press(view.getByTestId('home-tab'));

      await rtl.waitFor(() => {
        expect(view!.getByTestId('model-summary-count-text')).toHaveTextContent(
          '0',
        );
        expect(
          view!.getByTestId('model-summary-text').props.accessibilityState
            .selected,
        ).toBe(true);
      });
    } finally {
      view?.unmount();
      global.fetch = originalFetch;
    }
  }, 20000);
});
