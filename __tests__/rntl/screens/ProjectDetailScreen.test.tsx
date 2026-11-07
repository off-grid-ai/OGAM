/**
 * ProjectDetailScreen — a project's own page: what it is for, New chat, what it knows (its
 * instructions and its files, each opening its own screen), and its chats under one label.
 *
 * The real page runs on a real stack navigator with the real Files screen, the real project, chat and
 * app stores and the real knowledge base over the document engine's device boundary
 * (harness/knowledgeBaseApp). The editor and the chat are plain screens that name where a tap went.
 * Chats and files are put in place through the stores' and the knowledge base's own actions.
 */
import { openProjectPage, type ProjectPageOptions } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');

/** A downloaded text model, chosen or not, through the app store's own actions. */
function downloadModel(choose = true) {
  const { useAppStore } = require('../../../src/stores/appStore');
  const model = require('../../utils/factories').createDownloadedModel({ id: 'model-1' });
  useAppStore.getState().addDownloadedModel(model);
  if (choose) useAppStore.getState().setActiveModelId(model.id);
}

/** Add pasted notes to the project through the real knowledge base. */
async function addNotes(projectId: string, count: number) {
  const { knowledgeBase } = require('../../../src/services/rag');
  for (let i = 1; i <= count; i++) {
    await knowledgeBase.addPastedText({ projectId, title: `Note ${i}`, text: `Note number ${i}.` });
  }
}

const chatStore = () => require('../../../src/stores/chatStore').useChatStore;

async function page(options: ProjectPageOptions & { model?: boolean } = {}) {
  const { model = true, beforeMount, ...rest } = options;
  return openProjectPage({
    ...rest,
    beforeMount: engine => {
      if (model) downloadModel();
      beforeMount?.(engine);
    },
  });
}

describe('ProjectDetailScreen', () => {
  describe('the header', () => {
    it('names the project, says what it is for, and offers New chat', async () => {
      const app = await page({ projectName: 'Spanish', description: 'Practice for the trip' });

      expect(app.view.getByText('Spanish')).toBeTruthy();
      expect(app.view.getByText('Practice for the trip')).toBeTruthy();
      expect(app.view.getByTestId('project-new-chat')).toHaveTextContent('New chat');
    });

    it.each([
      ['has none', ''],
      ['only repeats the name', '  spanish '],
    ])('says what chats here share when its purpose %s', async (_case, description) => {
      const app = await page({ projectName: 'Spanish', description });

      expect(app.view.getByText('Chats here share these instructions and files.')).toBeTruthy();
    });

    it('offers no New chat while there is no model to chat with', async () => {
      const app = await page({ model: false });

      expect(app.view.queryByTestId('project-new-chat')).toBeNull();
    });

    it('Edit opens the project editor for this project', async () => {
      const app = await page();

      app.rtl.fireEvent.press(app.view.getByLabelText('Edit project'));

      await app.rtl.waitFor(() =>
        expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectEdit', params: { projectId: app.project.id } })),
      );
    });

    it('a project that is gone says so, and Go back leaves it', async () => {
      const app = await page();
      const { StackActions } = require('@react-navigation/native');
      // Another part of the app opens a project that has since been deleted.
      app.rtl.act(() => {
        app.dispatch(StackActions.push('ProjectDetail', { projectId: 'deleted-project' }));
      });

      expect(await app.view.findByText('Project not found')).toBeTruthy();
      app.rtl.fireEvent.press(app.view.getByText('Go back'));

      await app.rtl.waitFor(() => expect(app.route()?.params).toEqual({ projectId: app.project.id }));
      expect(app.view.queryByText('Project not found')).toBeNull();
    });

    it('Back leaves the page for the screen it was opened from', async () => {
      const app = await page();
      const { StackActions } = require('@react-navigation/native');
      app.rtl.act(() => {
        app.dispatch(StackActions.push('ProjectEdit', { projectId: app.project.id }));
      });
      app.rtl.act(() => {
        app.dispatch(StackActions.push('ProjectDetail', { projectId: app.project.id }));
      });
      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectDetail'));

      const backs = app.view.getAllByLabelText('Back');
      app.rtl.fireEvent.press(backs[backs.length - 1]);

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('ProjectEdit'));
    });
  });

  describe('what it knows', () => {
    it('shows the first line of its instructions, and the row opens the editor', async () => {
      const app = await page({ systemPrompt: '  Answer in Spanish.\nKeep it short.' });

      expect(app.view.getByText('What it knows')).toBeTruthy();
      const row = app.view.getByTestId('project-instructions');
      expect(row).toHaveProp('accessibilityLabel', 'Instructions: Answer in Spanish.');
      expect(app.rtl.within(row).getByText('Instructions')).toBeTruthy();
      expect(app.rtl.within(row).getByText('Answer in Spanish.')).toBeTruthy();
      expect(app.rtl.within(row).queryByText(/Keep it short/)).toBeNull();

      app.rtl.fireEvent.press(row);

      await app.rtl.waitFor(() =>
        expect(app.route()).toEqual(expect.objectContaining({ name: 'ProjectEdit', params: { projectId: app.project.id } })),
      );
    });

    it('asks for instructions when there are none', async () => {
      const app = await page({ systemPrompt: '   ' });
      const row = app.view.getByTestId('project-instructions');

      expect(row).toHaveProp('accessibilityLabel', 'Add instructions');
      expect(app.rtl.within(row).getByText('Add instructions')).toBeTruthy();
      expect(app.rtl.within(row).getByText('Tell every chat here how to answer.')).toBeTruthy();
    });

    it.each([
      [0, 'Add a file', 'Chats here then answer from it.'],
      [1, '1 file', 'Chats here answer from it.'],
      [3, '3 files', 'Chats here answer from these.'],
    ])('with %i files reads "%s"', async (count, title, line) => {
      const app = await page({ seed: projectId => addNotes(projectId, count) });
      const row = app.view.getByTestId('project-files');

      await app.rtl.waitFor(() => expect(app.view.getByTestId('project-knowledge-base-count')).toHaveTextContent(title));
      expect(app.rtl.within(row).getByText(line)).toBeTruthy();
    });

    it('names the files row for a screen reader', async () => {
      const empty = await page();
      expect(empty.view.getByTestId('project-files')).toHaveProp('accessibilityLabel', 'Add a file');
      empty.view.unmount();

      const full = await page({ seed: projectId => addNotes(projectId, 2) });
      await full.rtl.waitFor(() => expect(full.view.getByTestId('project-files')).toHaveProp('accessibilityLabel', '2 files'));
    });

    it('the files row opens the project\'s Files screen, and a file added there is counted on return', async () => {
      const app = await page({ projectName: 'Field Ops' });

      app.rtl.fireEvent.press(app.view.getByTestId('project-files'));

      await app.view.findByTestId('knowledge-base-screen');
      expect(app.route()).toEqual(expect.objectContaining({ name: 'KnowledgeBase', params: { projectId: app.project.id } }));
      await addNotes(app.project.id, 1);
      app.rtl.fireEvent.press(app.view.getByTestId('knowledge-base-back'));
      await app.rtl.waitFor(() => expect(app.view.getByTestId('project-knowledge-base-count')).toHaveTextContent('1 file'));
    });
  });

  describe('its chats', () => {
    it('with none, counts 0 and says what a chat here will use', async () => {
      const app = await page();

      expect(app.view.getByTestId('project-chats-count')).toHaveTextContent('Chats · 0');
      expect(app.view.getByText("Start a chat. It follows this project's instructions.")).toBeTruthy();
      expect(app.view.queryByTestId('project-start-chat')).toBeNull();
    });

    it('lists this project\'s chats newest first, each with its preview line, and counts them', async () => {
      const app = await page({
        seed: projectId => {
          const chats = chatStore().getState();
          chats.createConversation('model-1', 'Quiet chat', projectId);
          const busy = chats.createConversation('model-1', 'Busy chat', projectId);
          chats.createConversation('model-1', 'Somewhere else');
          chats.addMessage(busy, { role: 'user', content: 'How do I say hello?' });
        },
      });

      expect(app.view.getByTestId('project-chats-count')).toHaveTextContent('Chats · 2');
      const titles = app.view.getAllByText(/^(Quiet|Busy) chat$/).map(node => node.props.children);
      expect(titles).toEqual(['Busy chat', 'Quiet chat']);
      expect(app.view.getByText(/How do I say hello\?/)).toBeTruthy();
      expect(app.view.queryByText('Somewhere else')).toBeNull();
      expect(app.view.queryByText("Start a chat. It follows this project's instructions.")).toBeNull();
    });

    it('opens a chat when its row is tapped', async () => {
      let id = '';
      const app = await page({ seed: projectId => { id = chatStore().getState().createConversation('model-1', 'Verbs', projectId); } });

      app.rtl.fireEvent.press(app.view.getByText('Verbs'));

      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'Chat', params: { conversationId: id } })));
      expect(chatStore().getState().activeConversationId).toBe(id);
    });

    it('deletes a chat after the person confirms, and keeps it when they cancel', async () => {
      const app = await page({ seed: projectId => { chatStore().getState().createConversation('model-1', 'Verbs', projectId); } });

      app.rtl.fireEvent.press(app.view.getByLabelText('Delete Verbs'));
      expect(app.view.getByText('Delete "Verbs"?')).toBeTruthy();
      app.rtl.fireEvent.press(app.view.getByText('Cancel'));
      expect(chatStore().getState().conversations.map((c: { title: string }) => c.title)).toContain('Verbs');

      app.rtl.fireEvent.press(app.view.getByLabelText('Delete Verbs'));
      await app.rtl.act(async () => { app.rtl.fireEvent.press(app.view.getByText('Delete')); });

      await app.rtl.waitFor(() => expect(app.view.getByTestId('project-chats-count')).toHaveTextContent('Chats · 0'));
      expect(chatStore().getState().conversations.map((c: { title: string }) => c.title)).not.toContain('Verbs');
    });
  });

  describe('New chat', () => {
    it('starts a chat in this project with the chosen model and opens it', async () => {
      const app = await page();

      app.rtl.fireEvent.press(app.view.getByTestId('project-new-chat'));

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('Chat'));
      const [chat] = chatStore().getState().conversations;
      expect(chat).toEqual(expect.objectContaining({ projectId: app.project.id, modelId: 'model-1' }));
      expect(app.route()?.params).toEqual({ conversationId: chat.id, projectId: app.project.id });
    });

    it('uses the first downloaded model when none is chosen', async () => {
      const app = await page({ model: false, beforeMount: () => downloadModel(false) });

      app.rtl.fireEvent.press(app.view.getByTestId('project-new-chat'));

      await app.rtl.waitFor(() => expect(app.route()?.name).toBe('Chat'));
      expect(chatStore().getState().conversations[0]).toEqual(expect.objectContaining({ modelId: 'model-1' }));
    });

    it.each([
      ['a video model on the phone', () => require('../../../src/stores/appStore').useAppStore.getState().setActiveVideoModelId('wan-video')],
      ['a video model on a server', () => require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().setActiveRemoteMediaServerId('video', 'server-1')],
    ])('with only %s, opens a chat in this project without making one yet', async (_case, chooseVideo) => {
      const app = await page({ model: false, beforeMount: () => { chooseVideo(); } });

      app.rtl.fireEvent.press(app.view.getByTestId('project-new-chat'));

      await app.rtl.waitFor(() => expect(app.route()).toEqual(expect.objectContaining({ name: 'Chat', params: { projectId: app.project.id } })));
      expect(chatStore().getState().conversations).toHaveLength(0);
    });
  });
});
