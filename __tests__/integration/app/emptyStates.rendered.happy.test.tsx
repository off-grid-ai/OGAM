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

  it('shows an actionable empty knowledge base for a new project', async () => {
    const { rtl, view } = await renderMainApp({
      beforeRender: ({ asyncStorage }) =>
        asyncStorage.removeItem('local-llm-project-storage'),
    });

    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('New')));
    rtl.fireEvent.changeText(
      await rtl.waitFor(() =>
        view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
      ),
      'Empty KB Project',
    );
    rtl.fireEvent.changeText(
      view.getByPlaceholderText(
        'Enter the instructions or context for the AI...',
      ),
      'Answer only from project documents.',
    );
    rtl.fireEvent.press(view.getByText('Save'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Empty KB Project')),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('No documents added')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Knowledge Base'));
    await rtl.waitFor(() => {
      expect(view.getByText('No documents yet')).toBeTruthy();
      expect(view.getByText('Add Document')).toBeTruthy();
    });
    view.unmount();
  });
});
