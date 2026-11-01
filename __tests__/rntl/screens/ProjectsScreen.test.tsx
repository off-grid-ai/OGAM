/**
 * Projects tab.
 *
 * The real Projects screen runs on a real stack navigator with the real project editor and the
 * project and chat stores (projectsApp). Projects are made through the editor (New → fill → Save);
 * chats are filed into a project through the chat store's own action. Each test reads what the
 * person sees and where a tap goes.
 */
jest.unmock('@react-navigation/native');

import { mountProjectsApp, type ProjectsApp } from '../../harness/projectsApp';

async function makeProject(app: ProjectsApp, name: string, description = '') {
  app.rtl.fireEvent.press(app.view.getByTestId(app.view.queryByTestId('new-project-empty-button') ? 'new-project-empty-button' : 'new-project-button'));
  await app.rtl.waitFor(() => expect(app.view.getByText('New Project')).toBeTruthy());
  await app.fillAndSave({ name, description, systemPrompt: 'Be helpful' });
  await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
  return app.useProjectStore.getState().projects.find(p => p.name === name)!.id;
}

/** The list row for this project. */
const rowOf = (app: ProjectsApp, id: string) => app.rtl.within(app.view.getByTestId(`project-row-${id}`));

describe('ProjectsScreen', () => {
  it('shows the title, what projects are for, and New', async () => {
    const app = await mountProjectsApp();

    expect(app.view.getByText('Projects')).toBeTruthy();
    expect(app.view.getByText('Projects group related chats with shared context and instructions.')).toBeTruthy();
    expect(app.view.getByText('New')).toBeTruthy();
  });

  describe('with no projects', () => {
    it('says there are none yet and offers Create Project', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });

      expect(app.view.getByText('No Projects Yet')).toBeTruthy();
      expect(app.view.getByText(/Create a project to organize your chats by topic/)).toBeTruthy();
      expect(app.view.getByText('Create Project')).toBeTruthy();
    });

    it('Create Project opens an empty editor, and the saved project replaces the empty state', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });

      app.rtl.fireEvent.press(app.view.getByText('Create Project'));
      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectEdit', params: {} })));
      await app.fillAndSave({ name: 'Code Review', systemPrompt: 'Review code' });

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
      expect(app.view.getByText('Code Review')).toBeTruthy();
      expect(app.view.queryByText('No Projects Yet')).toBeNull();
    });
  });

  describe('the list', () => {
    it('lists each project with its initial, and its description only when it has one', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const alpha = await makeProject(app, 'Project Alpha', 'A detailed project description');
      const beta = await makeProject(app, 'Sample Beta');

      expect(rowOf(app, alpha).getByText('Project Alpha')).toBeTruthy();
      expect(rowOf(app, alpha).getByText('A detailed project description')).toBeTruthy();
      expect(rowOf(app, alpha).getByText('P')).toBeTruthy();
      expect(rowOf(app, beta).getByText('Sample Beta')).toBeTruthy();
      expect(rowOf(app, beta).getByText('S')).toBeTruthy();
      expect(rowOf(app, beta).queryByText('A detailed project description')).toBeNull();
    });

    it('counts the chats filed in each project', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const busy = await makeProject(app, 'Busy');
      const quiet = await makeProject(app, 'Quiet');
      const empty = await makeProject(app, 'Empty');

      app.rtl.act(() => {
        const chats = app.useChatStore.getState();
        chats.createConversation('model-1', 'One', busy);
        chats.createConversation('model-1', 'Two', busy);
        chats.createConversation('model-1', 'Three', quiet);
        chats.createConversation('model-1', 'Loose');
      });

      expect(rowOf(app, busy).getByText('2')).toBeTruthy();
      expect(rowOf(app, quiet).getByText('1')).toBeTruthy();
      expect(rowOf(app, empty).getByText('0')).toBeTruthy();
    });

    it('opening a project shows that project', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const id = await makeProject(app, 'Nav Test');

      app.rtl.fireEvent.press(app.view.getByText('Nav Test'));

      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectDetail', params: { projectId: id } })));
      expect(app.view.getByText(`Project detail ${id}`)).toBeTruthy();
    });

    it('New opens an empty editor', async () => {
      const app = await mountProjectsApp();

      app.rtl.fireEvent.press(app.view.getByText('New'));

      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectEdit', params: {} })));
      expect(app.view.getByText('New Project')).toBeTruthy();
    });
  });
});
