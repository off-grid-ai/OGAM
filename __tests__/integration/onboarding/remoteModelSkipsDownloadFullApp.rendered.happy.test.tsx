/** P2 #3 — connecting a remote model completes the remaining model onboarding step. */
import { renderFreshApp } from '../../harness/appJourney';

describe('P2 remote-model onboarding journey', () => {
  it('enters Home after a server model is connected from the download step', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            object: 'list',
            data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }],
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response;
    });

    try {
      const { rtl, view } = await renderFreshApp();
      const { Dimensions } = require('react-native');
      const width = Dimensions.get('window').width;
      const slides = view.getByTestId('onboarding-slides');

      for (const index of [0, 1, 2]) {
        rtl.fireEvent.press(view.getByTestId('onboarding-next'));
        rtl.fireEvent(slides, 'momentumScrollEnd', {
          nativeEvent: { contentOffset: { x: (index + 1) * width } },
        });
      }
      await rtl.waitFor(() =>
        expect(view.getByText('Get Started')).toBeTruthy(),
      );
      rtl.fireEvent.press(view.getByTestId('onboarding-next'));
      await rtl.waitFor(() =>
        expect(view.getByTestId('model-download-screen')).toBeTruthy(),
      );

      rtl.fireEvent.press(view.getByText('Add Server'));
      rtl.fireEvent.changeText(
        await rtl.waitFor(() =>
          view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
        ),
        'My Desktop',
      );
      rtl.fireEvent.changeText(
        view.getByPlaceholderText('http://192.168.1.50:7878'),
        'http://localhost:1234',
      );
      rtl.fireEvent.press(view.getByText('Test Connection'));
      await rtl.waitFor(
        () => expect(view.getByText(/Connected \(/)).toBeTruthy(),
        { timeout: 4000 },
      );
      const addButtons = view.getAllByText('Add Server');
      rtl.fireEvent.press(addButtons[addButtons.length - 1]);

      rtl.fireEvent.press(
        await rtl.waitFor(
          () => view.getByTestId(/^discovered-server-.*-connect$/),
          { timeout: 4000 },
        ),
      );
      rtl.fireEvent.press(
        await rtl.waitFor(() => view.getByText('Continue'), {
          timeout: 4000,
        }),
      );

      await rtl.waitFor(
        () => expect(view.getByTestId('home-screen')).toBeTruthy(),
        { timeout: 4000 },
      );
      expect(view.queryByTestId('model-download-screen')).toBeNull();
      view.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  }, 30000);
});
