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
  await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectEdit'));
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
    it('says there are none yet and offers New project', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });

      expect(app.view.getByText('No projects yet')).toBeTruthy();
      expect(app.view.getByText(/Keep related chats together/)).toBeTruthy();
      expect(app.view.getByText('New project')).toBeTruthy();
    });

    it('New project opens an empty editor, and the saved project replaces the empty state', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });

      app.rtl.fireEvent.press(app.view.getByText('New project'));
      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectEdit', params: {} })));
      await app.fillAndSave({ name: 'Code Review', systemPrompt: 'Review code' });

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
      expect(app.view.getByText('Code Review')).toBeTruthy();
      expect(app.view.queryByText('No projects yet')).toBeNull();
    });
  });

  describe('the list', () => {
    it('lists each project by name; what it is for stays on its own page', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const alpha = await makeProject(app, 'Project Alpha', 'A detailed project description');

      expect(rowOf(app, alpha).getByText('Project Alpha')).toBeTruthy();
      expect(app.view.queryByText('A detailed project description')).toBeNull();
    });

    it('says how many chats each project holds', async () => {
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

      expect(app.view.getByTestId(`project-chats-${busy}`)).toHaveTextContent('2');
      expect(app.view.getByTestId(`project-chats-${quiet}`)).toHaveTextContent('1');
      expect(app.view.getByTestId(`project-chats-${empty}`)).toHaveTextContent('0');
      expect(app.view.getByTestId(`project-row-${busy}`).props.accessibilityHint).toMatch(/^2 chats, 0 documents, last used /);
    });

    it('says how many files each project holds', async () => {
      const ids: Record<string, string> = {};
      const app = await mountProjectsApp({
        noStarterProjects: true,
        files: true,
        seed: async ({ useProjectStore, knowledgeBase }) => {
          for (const name of ['Manuals', 'Bare']) {
            ids[name] = useProjectStore.getState().createProject({ name, description: '', systemPrompt: 'Help' }).id;
          }
          await knowledgeBase.addPastedText({ projectId: ids.Manuals, title: 'Pump', text: 'Prime the pump first.' });
          await knowledgeBase.addPastedText({ projectId: ids.Manuals, title: 'Valve', text: 'Close the valve after.' });
        },
      });

      await app.rtl.waitFor(() => expect(app.view.getByTestId(`project-documents-${ids.Manuals}`)).toHaveTextContent('2'));
      expect(app.view.getByTestId(`project-documents-${ids.Bare}`)).toHaveTextContent('0');
    });

    it('dates a project by its most recent chat', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const id = await makeProject(app, 'Dated');
      const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

      app.rtl.act(() => {
        const chats = app.useChatStore.getState();
        chats.createConversation('model-1', 'Old', id);
        chats.createConversation('model-1', 'Newer', id);
        const at = { Old: daysAgo(60), Newer: daysAgo(10) } as Record<string, string>;
        app.useChatStore.setState({
          conversations: app.useChatStore.getState().conversations.map(c => ({ ...c, updatedAt: at[c.title] ?? c.updatedAt })),
        });
      });

      expect(rowOf(app, id).getByText('Last week')).toBeTruthy();
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
      expect(app.view.getByText('New project')).toBeTruthy();
    });
  });
});
