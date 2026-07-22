/** P1 #122 — deleting a project keeps its chats usable and removes the stale project association. */
import {
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROJECT = 'Temporary Research';
const MESSAGE = 'Keep this field note after project deletion';
const REPLY = 'The field note is saved in this chat.';

async function createProject(
  rtl: Awaited<ReturnType<typeof renderMainApp>>['rtl'],
  view: Awaited<ReturnType<typeof renderMainApp>>['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('projects-tab'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('New')));
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
    PROJECT,
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText(
      'Enter the instructions or context for the AI...',
    ),
    'Keep concise research notes.',
  );
  rtl.fireEvent.press(view.getByText('Save'));
  await rtl.waitFor(() => expect(view.getByText(PROJECT)).toBeTruthy());
}

describe('P1 full-App project deletion journey', () => {
  it('unfiles the project chats so they remain visible and usable after relaunch', async () => {
    const first = await renderMainApp({ boundary: { llama: true } });
    first.rtl.fireEvent.press(first.view.getByTestId('browse-models-button'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByTestId('model-item')),
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    await createProject(first.rtl, first.view);
    first.rtl.fireEvent.press(first.view.getByText(PROJECT));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('No chats yet')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByText('Start a Chat'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('chat-screen')).toBeTruthy(),
    );

    first.boundary.llama!.scriptCompletion({ text: REPLY });
    sendChatMessage(first.rtl, first.view, MESSAGE);
    await first.rtl.waitFor(() =>
      expect(first.view.getByText(REPLY)).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('chat-back-button'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Delete Project')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByText('Delete Project'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText('Delete')),
    );

    await first.rtl.waitFor(() => {
      expect(first.view.queryByText(PROJECT)).toBeNull();
      expect(first.view.getByTestId('projects-tab')).toBeTruthy();
    });
    first.rtl.fireEvent.press(first.view.getByTestId('chats-tab'));
    await first.rtl.waitFor(() => {
      expect(first.view.getByText(MESSAGE)).toBeTruthy();
      expect(first.view.getByText(REPLY)).toBeTruthy();
      expect(first.view.queryByText(PROJECT)).toBeNull();
    });

    first.view.unmount();
    const relaunched = await relaunchMainApp({ boundary: { llama: true } });
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('chats-tab'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(MESSAGE)).toBeTruthy();
      expect(relaunched.view.getByText(REPLY)).toBeTruthy();
      expect(relaunched.view.queryByText(PROJECT)).toBeNull();
    });
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('conversation-item-0'),
    );
    await relaunched.rtl.waitFor(() => {
      const chat = relaunched.view.getByTestId('chat-screen');
      expect(
        relaunched.rtl.within(chat).getAllByText(MESSAGE).length,
      ).toBeGreaterThan(0);
      expect(relaunched.rtl.within(chat).getByText(REPLY)).toBeTruthy();
      expect(relaunched.rtl.within(chat).getByText('Default')).toBeTruthy();
    });
    relaunched.view.unmount();
  }, 30000);
});
