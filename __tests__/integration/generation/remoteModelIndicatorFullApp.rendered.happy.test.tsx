/** P2 #140 — remote text models remain visibly distinguished through the real App journey. */
import { renderMainApp } from '../../harness/appJourney';

const originalFetch = global.fetch;

describe('P2 full-app remote model indicator', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('marks a connected remote model with a cloud in the chat model manager', async () => {
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
    const { rtl, view } = await renderMainApp();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Remote Servers')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Remote Servers'));
    await rtl.waitFor(() =>
      expect(view.getByText('No Remote Servers')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByText('Add Server'));
    rtl.fireEvent.changeText(
      await rtl.waitFor(() =>
        view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
      ),
      'My LM Studio',
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
    await rtl.waitFor(() => {
      expect(view.getByText('My LM Studio')).toBeTruthy();
      expect(view.getByText('Connected')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('remote-servers-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('settings-tab')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    await rtl.waitFor(() => {
      expect(view.getByText('My LM Studio')).toBeTruthy();
      expect(view.getByText('llama-3-8b')).toBeTruthy();
      expect(view.getByTestId('remote-model-item')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('remote-model-item'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));

    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /llama-3-8b/,
      );
      expect(view.getByTestId('models-row-text-remote')).toBeTruthy();
    });
    view.unmount();
  }, 30000);
});
