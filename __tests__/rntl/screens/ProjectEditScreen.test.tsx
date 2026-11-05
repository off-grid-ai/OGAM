/**
 * Project editor — create a project, or edit one.
 *
 * The real editor runs as a modal over the real Projects tab on a real stack navigator
 * (projectsApp), with the real project store. A new project is made the way a person makes one:
 * Projects → New → fill in → Save. Each test reads what the person sees: the editor's fields, its
 * alerts, and the Projects list it returns to.
 */
jest.unmock('@react-navigation/native');

import { mountProjectsApp, PROJECT_FIELDS, type ProjectsApp } from '../../harness/projectsApp';

/** Projects → New: the editor opens empty. */
async function openNew(app: ProjectsApp) {
  app.rtl.fireEvent.press(app.view.getByTestId('new-project-button'));
  await app.rtl.waitFor(() => expect(app.view.getByText('New project')).toBeTruthy());
}

/** Make a project through the editor and return its id. */
async function makeProject(app: ProjectsApp, fields: { name: string; description?: string; systemPrompt: string }) {
  await openNew(app);
  await app.fillAndSave(fields);
  await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
  return app.useProjectStore.getState().projects.find(p => p.name === fields.name)!.id;
}

describe('ProjectEditScreen', () => {
  describe('a new project', () => {
    it('opens empty under "New project", with the labels, hint and tip', async () => {
      const app = await mountProjectsApp();
      await openNew(app);
      const { view } = app;

      expect(view.getByText('Cancel')).toBeTruthy();
      expect(view.getByText('Save')).toBeTruthy();
      expect(view.getByText('Name *')).toBeTruthy();
      expect(view.getByText('Description')).toBeTruthy();
      expect(view.getByText('System Prompt *')).toBeTruthy();
      expect(view.getByText(/This context is sent to the AI at the start of every chat/)).toBeTruthy();
      expect(view.getByText(/Tip: Be specific about what you want the AI to do/)).toBeTruthy();
      for (const placeholder of Object.values(PROJECT_FIELDS)) {
        expect(view.getByPlaceholderText(placeholder).props.value).toBe('');
      }
    });

    it('Save creates it with trimmed fields and returns to Projects, which lists it', async () => {
      const app = await mountProjectsApp();
      await openNew(app);

      await app.fillAndSave({ name: '  My New Project  ', description: '  A description  ', systemPrompt: '  You are helpful  ' });

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
      expect(app.view.getByText('My New Project')).toBeTruthy();
      expect(app.view.getByText('A description')).toBeTruthy();
      const saved = app.useProjectStore.getState().projects.find(p => p.name === 'My New Project');
      expect(saved).toEqual(expect.objectContaining({ description: 'A description', systemPrompt: 'You are helpful' }));
    });

    it('Cancel returns to Projects without making anything', async () => {
      const app = await mountProjectsApp();
      const before = app.useProjectStore.getState().projects.length;
      await openNew(app);
      app.rtl.fireEvent.changeText(app.view.getByPlaceholderText(PROJECT_FIELDS.name), 'Abandoned');

      app.rtl.fireEvent.press(app.view.getByTestId('project-edit-cancel'));

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
      expect(app.view.queryByText('Abandoned')).toBeNull();
      expect(app.useProjectStore.getState().projects).toHaveLength(before);
    });
  });

  describe('validation', () => {
    it.each([
      ['an empty name', { name: '', systemPrompt: 'Be helpful' }, 'Please enter a name for the project'],
      ['a blank name', { name: '   ', systemPrompt: 'Be helpful' }, 'Please enter a name for the project'],
      ['an empty system prompt', { name: 'Named', systemPrompt: '' }, 'Please enter a system prompt'],
      ['a blank system prompt', { name: 'Named', systemPrompt: '   ' }, 'Please enter a system prompt'],
      // The name is checked first.
      ['neither', { name: '', systemPrompt: '' }, 'Please enter a name for the project'],
    ])('refuses %s and stays in the editor', async (_case, fields, message) => {
      const app = await mountProjectsApp();
      const before = app.useProjectStore.getState().projects.length;
      await openNew(app);

      await app.fillAndSave(fields);

      expect(app.view.getByText('Error')).toBeTruthy();
      expect(app.view.getByText(message)).toBeTruthy();
      expect(app.route()?.name).toBe('ProjectEdit');
      expect(app.useProjectStore.getState().projects).toHaveLength(before);
    });
  });

  describe('editing a project', () => {
    it('opens under "Edit project" with the project\'s fields filled in', async () => {
      const app = await mountProjectsApp();
      const id = await makeProject(app, { name: 'Test Project', description: 'Test desc', systemPrompt: 'Be helpful' });

      app.open('ProjectEdit', { projectId: id });

      await app.rtl.waitFor(() => expect(app.view.getByText('Edit project')).toBeTruthy());
      expect(app.view.getByDisplayValue('Test Project')).toBeTruthy();
      expect(app.view.getByDisplayValue('Test desc')).toBeTruthy();
      expect(app.view.getByDisplayValue('Be helpful')).toBeTruthy();
    });

    it('Save updates that project, trimmed, without making a new one', async () => {
      const app = await mountProjectsApp();
      const id = await makeProject(app, { name: 'Test Project', description: 'Test desc', systemPrompt: 'Be helpful' });
      const count = app.useProjectStore.getState().projects.length;
      app.open('ProjectEdit', { projectId: id });
      await app.rtl.waitFor(() => expect(app.view.getByDisplayValue('Test Project')).toBeTruthy());

      app.rtl.fireEvent.changeText(app.view.getByDisplayValue('Test Project'), '  Trimmed Name  ');
      app.rtl.fireEvent.changeText(app.view.getByDisplayValue('Test desc'), '  Trimmed Desc  ');
      app.rtl.fireEvent.changeText(app.view.getByDisplayValue('Be helpful'), '  Trimmed Prompt  ');
      await app.rtl.act(async () => { app.rtl.fireEvent.press(app.view.getByTestId('project-edit-save')); });

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectsTab'));
      expect(app.view.getByText('Trimmed Name')).toBeTruthy();
      expect(app.view.queryByText('Test Project')).toBeNull();
      expect(app.useProjectStore.getState().projects).toHaveLength(count);
      expect(app.useProjectStore.getState().getProject(id)).toEqual(
        expect.objectContaining({ name: 'Trimmed Name', description: 'Trimmed Desc', systemPrompt: 'Trimmed Prompt' }),
      );
    });
  });
});
