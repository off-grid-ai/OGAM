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
    it('lists each project by name, then its purpose; a purpose that only repeats the name is dropped', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const alpha = await makeProject(app, 'Project Alpha', 'A detailed project description');
      const beta = await makeProject(app, 'Sample Beta');
      const echo = await makeProject(app, 'Recipes', '  recipes ');

      expect(rowOf(app, alpha).getByText('Project Alpha')).toBeTruthy();
      expect(rowOf(app, alpha).getByText('A detailed project description')).toBeTruthy();
      expect(rowOf(app, alpha).queryByText('P')).toBeNull();
      expect(rowOf(app, beta).getByText('Sample Beta')).toBeTruthy();
      expect(rowOf(app, beta).queryByText('A detailed project description')).toBeNull();
      expect(rowOf(app, echo).getByText('Recipes')).toBeTruthy();
      expect(rowOf(app, echo).queryByText(/^\s*recipes\s*$/)).toBeNull();
    });

    it('says how many chats each project holds, in words', async () => {
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

      expect(rowOf(app, busy).getByText(/^2 chats · /)).toBeTruthy();
      expect(rowOf(app, quiet).getByText(/^1 chat · /)).toBeTruthy();
      expect(rowOf(app, empty).getByText(/^0 chats · /)).toBeTruthy();
    });

    it('dates a project by its most recent chat', async () => {
      const app = await mountProjectsApp({ noStarterProjects: true });
      const id = await makeProject(app, 'Dated');

      app.rtl.act(() => {
        const chats = app.useChatStore.getState();
        chats.createConversation('model-1', 'Old', id);
        chats.createConversation('model-1', 'Newer', id);
        const at = { Old: '2026-01-15T10:00:00.000Z', Newer: '2026-02-03T10:00:00.000Z' } as Record<string, string>;
        app.useChatStore.setState({
          conversations: app.useChatStore.getState().conversations.map((c: { title: string }) => ({ ...c, updatedAt: at[c.title] ?? (c as never as { updatedAt: string }).updatedAt })),
        });
      });

      expect(rowOf(app, id).getByText('2 chats · Feb 3')).toBeTruthy();
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
