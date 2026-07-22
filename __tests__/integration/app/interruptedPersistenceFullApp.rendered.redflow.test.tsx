/** APP-P0-004 - interrupted writes preserve the last committed chats and projects. */
import {
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const CHAT_STORAGE_KEY = 'local-llm-chat-storage';
const PROJECT_STORAGE_KEY = 'local-llm-project-storage';

async function createProject(
  rtl: Awaited<ReturnType<typeof renderMainApp>>['rtl'],
  view: Awaited<ReturnType<typeof renderMainApp>>['view'],
  name: string,
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('projects-tab'));
  await rtl.waitFor(() =>
    expect(
      view.getByText(
        'Projects group related chats with shared context and instructions.',
      ),
    ).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByText('New'));
  await rtl.waitFor(() => expect(view.getByText('New Project')).toBeTruthy());
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
    name,
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText(
      'Enter the instructions or context for the AI...',
    ),
    'Keep this project available offline.',
  );
  rtl.fireEvent.press(view.getByText('Save'));
  await rtl.waitFor(() => expect(view.getByText(name)).toBeTruthy());
}

describe('APP-P0-004 interrupted persistence', () => {
  it('restores the last committed chat and project after later writes are interrupted', async () => {
    const first = await renderMainApp({ boundary: { llama: true } });

    await openChatWithJourneyModel(first.rtl, first.view);
    first.boundary.llama!.scriptCompletion({
      text: 'Committed chat reply.',
    });
    sendChatMessage(first.rtl, first.view, 'Committed chat prompt');
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Committed chat reply.')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('chat-back-button'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('home-screen')).toBeTruthy(),
    );
    await createProject(first.rtl, first.view, 'Committed Project');

    // Establish the durable baseline before simulating interruption at the only
    // uncontrollable boundary: AsyncStorage's native commit.
    await first.rtl.waitFor(async () => {
      const [chat, project] = await Promise.all([
        first.asyncStorage.getItem(CHAT_STORAGE_KEY),
        first.asyncStorage.getItem(PROJECT_STORAGE_KEY),
      ]);
      expect(chat).toContain('Committed chat prompt');
      expect(project).toContain('Committed Project');
    });

    const setItem = first.asyncStorage.setItem as jest.MockedFunction<
      typeof first.asyncStorage.setItem
    >;
    const committedWrite = setItem.getMockImplementation();
    expect(committedWrite).toBeTruthy();
    setItem.mockImplementation((key, value) => {
      if (key === CHAT_STORAGE_KEY || key === PROJECT_STORAGE_KEY) {
        // The process stops before the native commit becomes durable. The prior
        // value remains, matching an atomic storage write interrupted in flight.
        return Promise.resolve();
      }
      return committedWrite!(key, value);
    });

    // Both later records exist in the live UI, proving real store updates reached
    // the interrupted persistence boundary rather than being skipped by the test.
    await createProject(first.rtl, first.view, 'Interrupted Project');
    first.rtl.fireEvent.press(first.view.getByTestId('home-tab'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('home-screen')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('new-chat-button'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('chat-screen')).toBeTruthy(),
    );
    first.boundary.llama!.scriptCompletion({
      text: 'Interrupted chat reply.',
    });
    sendChatMessage(first.rtl, first.view, 'Interrupted chat prompt');
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Interrupted chat reply.')).toBeTruthy(),
    );

    first.view.unmount();
    await first.rtl.act(async () => {
      await Promise.resolve();
    });
    setItem.mockImplementation(committedWrite!);

    const relaunched = await relaunchMainApp({ boundary: { llama: true } });

    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('projects-tab'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText('Committed Project')).toBeTruthy();
      expect(relaunched.view.queryByText('Interrupted Project')).toBeNull();
    });

    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('chats-tab'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(/Committed chat prompt/)).toBeTruthy();
      expect(relaunched.view.queryByText(/Interrupted chat prompt/)).toBeNull();
    });
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('conversation-item-0'),
    );
    await relaunched.rtl.waitFor(() => {
      expect(
        relaunched.view.getAllByText('Committed chat prompt').length,
      ).toBeGreaterThan(0);
      expect(relaunched.view.getByText('Committed chat reply.')).toBeTruthy();
    });

    relaunched.view.unmount();
  }, 60000);
});
