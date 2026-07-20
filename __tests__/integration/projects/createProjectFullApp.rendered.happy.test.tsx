/** P1 #112 / P2 #121 — create, restore, and edit a project through the real App. */
import Icon from 'react-native-vector-icons/Feather';
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';

const PROJECT_STORAGE_KEY = 'local-llm-project-storage';
const PROJECT_NAME = 'Offline Research Lab';
const PROJECT_DESCRIPTION = 'Organize private field research and notes';
const PROJECT_INSTRUCTIONS =
  'Help synthesize research notes into concise, evidence-based summaries.';
const EDITED_NAME = 'Private Field Lab';
const EDITED_DESCRIPTION = 'Keep private field research current';

describe('P1 full-App create-project journey', () => {
  it('creates, restores, and edits a complete project', async () => {
    const first = await renderMainApp();

    first.rtl.fireEvent.press(first.view.getByTestId('projects-tab'));
    await first.rtl.waitFor(() =>
      expect(
        first.view.getByText(
          'Projects group related chats with shared context and instructions.',
        ),
      ).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByText('New'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('New Project')).toBeTruthy(),
    );

    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
      PROJECT_NAME,
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('Brief description of this project'),
      PROJECT_DESCRIPTION,
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText(
        'Enter the instructions or context for the AI...',
      ),
      PROJECT_INSTRUCTIONS,
    );
    first.rtl.fireEvent.press(first.view.getByText('Save'));

    await first.rtl.waitFor(() => {
      expect(first.view.getAllByText(PROJECT_NAME)).toHaveLength(1);
      expect(first.view.getByText(PROJECT_DESCRIPTION)).toBeTruthy();
      expect(first.view.queryByText('New Project')).toBeNull();
    });

    await first.rtl.waitFor(async () => {
      const persisted = await first.asyncStorage.getItem(PROJECT_STORAGE_KEY);
      expect(persisted).toContain(PROJECT_NAME);
      expect(persisted).toContain(PROJECT_DESCRIPTION);
      expect(persisted).toContain(PROJECT_INSTRUCTIONS);
    });

    first.view.unmount();
    await first.rtl.act(async () => {
      await Promise.resolve();
    });

    const relaunched = await relaunchMainApp();
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('projects-tab'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getAllByText(PROJECT_NAME)).toHaveLength(1);
      expect(relaunched.view.getByText(PROJECT_DESCRIPTION)).toBeTruthy();
    });

    relaunched.rtl.fireEvent.press(relaunched.view.getByText(PROJECT_NAME));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(PROJECT_NAME)).toBeTruthy();
      expect(relaunched.view.getByText('Knowledge Base')).toBeTruthy();
      expect(relaunched.view.getByText('No chats yet')).toBeTruthy();
      expect(relaunched.view.queryByText('Project not found')).toBeNull();
    });

    const edit = relaunched.view
      .UNSAFE_getAllByType(Icon)
      .find(icon => icon.props.name === 'edit-2');
    if (!edit?.parent) throw new Error('Project edit control not found');
    relaunched.rtl.fireEvent.press(edit.parent);
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByText('Edit Project')).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.changeText(
      relaunched.view.getByDisplayValue(PROJECT_NAME),
      EDITED_NAME,
    );
    relaunched.rtl.fireEvent.changeText(
      relaunched.view.getByDisplayValue(PROJECT_DESCRIPTION),
      EDITED_DESCRIPTION,
    );
    relaunched.rtl.fireEvent.press(relaunched.view.getByText('Save'));
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByText(EDITED_NAME)).toBeTruthy();
      expect(relaunched.view.queryByText(PROJECT_NAME)).toBeNull();
    });
    await relaunched.rtl.waitFor(async () => {
      const persisted = await relaunched.asyncStorage.getItem(
        PROJECT_STORAGE_KEY,
      );
      expect(persisted).toContain(EDITED_NAME);
      expect(persisted).toContain(EDITED_DESCRIPTION);
      expect(persisted).not.toContain(PROJECT_NAME);
    });

    relaunched.view.unmount();
  }, 30000);
});
