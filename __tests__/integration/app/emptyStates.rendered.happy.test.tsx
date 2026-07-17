/** P2 #157/#158 — core empty states remain actionable in the real App. */
import { renderFreshApp, renderMainApp } from '../../harness/appJourney';

describe('P2 core empty-state journeys', () => {
  it('shows a clear path forward when no model is available', async () => {
    const { rtl, view } = await renderFreshApp();
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('onboarding-skip')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('model-download-skip')),
    );

    await rtl.waitFor(() => {
      expect(view.getByTestId('home-screen')).toBeTruthy();
      expect(view.getByTestId('setup-card')).toBeTruthy();
      expect(
        view.getByText(
          'Add a remote server or download a model to start chatting',
        ),
      ).toBeTruthy();
      expect(view.getByText('Browse Models')).toBeTruthy();
    });
    view.unmount();
  }, 30000);

  it('shows an actionable empty Chats list', async () => {
    const { rtl, view } = await renderMainApp({
      beforeRender: ({ asyncStorage }) =>
        asyncStorage.removeItem('local-llm-chat-storage'),
    });

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    await rtl.waitFor(() => {
      expect(view.getByText('No Chats Yet')).toBeTruthy();
      expect(
        view.getByText(
          'Download a model from the Models tab to start chatting.',
        ),
      ).toBeTruthy();
      expect(view.getByText('New')).toBeTruthy();
    });
    view.unmount();
  });
});
