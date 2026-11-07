/**
 * Chats list — the Chats tab.
 *
 * The real screen runs on a real stack navigator with the real model selector sheet, alert, chat,
 * project and app stores. Only the device is faked: native modules and the RAM sensor
 * (nativeBoundary), and the clock for "today / yesterday / last week" dates. Chats, messages,
 * projects and models are written through the stores' own actions. Each test reads what the person
 * sees and which screen the app is on.
 */
jest.unmock('@react-navigation/native');

import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

type Rtl = ReturnType<typeof requireRTL>;

interface App {
  rtl: Rtl;
  stores: {
    chat: typeof import('../../../src/stores/chatStore').useChatStore;
    app: typeof import('../../../src/stores/appStore').useAppStore;
    project: typeof import('../../../src/stores/projectStore').useProjectStore;
  };
  factories: typeof import('../../utils/factories');
  /** Start a chat with these messages, as the app's chat store records them. */
  chat(title: string, messages?: Array<{ role: 'user' | 'assistant'; content: string }>, projectId?: string): string;
  /** A downloaded text model; `active` also makes it the chosen one. */
  model(active: boolean): void;
  render(): { view: ReturnType<Rtl['render']>; route(): string | undefined; params(): unknown };
}

function boot(): App {
  installNativeBoundary({ ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB } });
  const React = require('react');
  const rtl = requireRTL();
  const { useChatStore } = require('../../../src/stores/chatStore');
  const { useAppStore } = require('../../../src/stores/appStore');
  const { useProjectStore } = require('../../../src/stores/projectStore');
  const factories = require('../../utils/factories');

  return {
    rtl,
    stores: { chat: useChatStore, app: useAppStore, project: useProjectStore },
    factories,
    chat: (title, messages = [], projectId) => {
      const id = useChatStore.getState().createConversation('model-1', title, projectId);
      for (const m of messages) useChatStore.getState().addMessage(id, m);
      return id;
    },
    model: active => {
      const model = factories.createDownloadedModel();
      useAppStore.getState().addDownloadedModel(model);
      if (active) useAppStore.getState().setActiveModelId(model.id);
    },
    render: () => {
      const nav = require('@react-navigation/native');
      const { createNativeStackNavigator } = require('@react-navigation/native-stack');
      const { Text } = require('react-native');
      const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
      const Stack = createNativeStackNavigator();
      const ref = nav.createNavigationContainerRef();
      const ChatStub = () => React.createElement(Text, null, 'Chat screen');
      const view = rtl.render(
        React.createElement(
          nav.NavigationContainer,
          { ref },
          React.createElement(
            Stack.Navigator,
            null,
            React.createElement(Stack.Screen, { name: 'ChatsTab', component: ChatsListScreen }),
            React.createElement(Stack.Screen, { name: 'Chat', component: ChatStub }),
          ),
        ),
      );
      return {
        view,
        route: () => ref.getCurrentRoute()?.name,
        params: () => ref.getCurrentRoute()?.params,
      };
    },
  };
}

/** The list row that shows this chat title. */
function rowOf(app: App, view: ReturnType<Rtl['render']>, title: string) {
  const rows = view.getAllByTestId(/^conversation-item-/).map(row => app.rtl.within(row));
  const row = rows.find(r => r.queryByText(title));
  if (!row) throw new Error(`No row shows ${title}`);
  return row;
}

describe('ChatsListScreen', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('with no chats', () => {
    it('says to download a model when there is none, with no New Chat button', () => {
      const app = boot();
      const { view } = app.render();

      expect(view.getByText('Chats')).toBeTruthy();
      expect(view.getByText('New')).toBeTruthy();
      expect(view.getByText('No chats yet')).toBeTruthy();
      expect(view.getByText('Download a model from the Models tab to start chatting.')).toBeTruthy();
      expect(view.queryByText('New chat')).toBeNull();
    });

    it('New with no model opens the model sheet instead of a chat', async () => {
      const app = boot();
      const { view, route } = app.render();

      app.rtl.fireEvent.press(view.getByText('New'));

      await app.rtl.waitFor(() => expect(view.getByText('TEXT MODEL')).toBeTruthy());
      expect(route()).toBe('ChatsTab');
    });

    it('New with a downloaded but unchosen model opens the model sheet', async () => {
      const app = boot();
      app.model(false);
      const { view, route } = app.render();

      app.rtl.fireEvent.press(view.getByText('New'));

      await app.rtl.waitFor(() => expect(view.getByText('TEXT MODEL')).toBeTruthy());
      expect(route()).toBe('ChatsTab');
    });

    it('New with only an image model opens the model sheet', async () => {
      const app = boot();
      app.stores.app.getState().addDownloadedImageModel(app.factories.createONNXImageModel());
      const { view } = app.render();

      app.rtl.fireEvent.press(view.getByText('New'));

      await app.rtl.waitFor(() => expect(view.getByText('TEXT MODEL')).toBeTruthy());
    });

    it('with a chosen model, invites a new chat, and New chat opens an empty chat', async () => {
      const app = boot();
      app.model(true);
      const { view, route, params } = app.render();

      expect(view.getByText('Start a new conversation to begin chatting with your local AI.')).toBeTruthy();
      app.rtl.fireEvent.press(view.getByText('New chat'));
      await app.rtl.waitFor(() => expect(route()).toBe('Chat'));
      expect(params()).toEqual({});
    });

    it('with a chosen model, the header New opens an empty chat', async () => {
      const app = boot();
      app.model(true);
      const { view, route, params } = app.render();

      app.rtl.fireEvent.press(view.getByText('New'));

      await app.rtl.waitFor(() => expect(route()).toBe('Chat'));
      expect(params()).toEqual({});
    });
  });

  describe('the list', () => {
    it('lists each chat, newest first, and drops the empty state', () => {
      const app = boot();
      jest.useFakeTimers({ now: new Date(2024, 0, 1, 12, 0) });
      app.chat('Older Chat');
      jest.setSystemTime(new Date(2024, 5, 1, 12, 0));
      app.chat('Newer Chat');
      const { view } = app.render();

      expect(view.getByTestId('conversation-list')).toBeTruthy();
      expect(view.queryByText('No chats yet')).toBeNull();
      expect(app.rtl.within(view.getByTestId('conversation-item-0')).getByText('Newer Chat')).toBeTruthy();
      expect(app.rtl.within(view.getByTestId('conversation-item-1')).getByText('Older Chat')).toBeTruthy();
    });

    it('previews the last reply, or the person\'s own last message with "You:"', () => {
      const app = boot();
      app.chat('Answered', [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi! How can I help you?' },
      ]);
      app.chat('Asked', [{ role: 'user', content: 'My question' }]);
      app.chat('Empty Conv');
      const { view } = app.render();

      expect(view.getByText('Hi! How can I help you?')).toBeTruthy();
      expect(view.getByText(/You:.*My question/)).toBeTruthy();
      expect(view.queryByText(/Hello there/)).toBeNull();
      expect(rowOf(app, view, 'Empty Conv').queryByText(/You:/)).toBeNull();
    });

    it('badges a chat with its project, and nothing for a chat outside one or in a deleted one', () => {
      const app = boot();
      const project = app.stores.project.getState().createProject({ name: 'Code Review', description: '', systemPrompt: '' });
      app.chat('Project Chat', [], project.id);
      app.chat('Loose Chat');
      app.chat('Orphan Chat', [], 'non-existent-project-id');
      const { view } = app.render();

      expect(view.getAllByText('Code Review')).toHaveLength(1);
      expect(rowOf(app, view, 'Project Chat').getByText('Code Review')).toBeTruthy();
      expect(rowOf(app, view, 'Loose Chat').queryByText('Code Review')).toBeNull();
      expect(rowOf(app, view, 'Orphan Chat').queryByText('Code Review')).toBeNull();
    });

    it('dates a chat under its day heading: the clock time today and yesterday, the weekday this week, Last week, N weeks ago, else the date', () => {
      const app = boot();
      jest.useFakeTimers({ now: new Date(2026, 8, 1, 9, 30) });
      app.chat('Old Chat');
      jest.setSystemTime(new Date(2026, 9, 16, 9, 30));
      app.chat('Two Weeks Chat');
      jest.setSystemTime(new Date(2026, 9, 22, 9, 30));
      app.chat('Last Week Chat');
      jest.setSystemTime(new Date(2026, 9, 27, 9, 30));
      app.chat('Recent Chat');
      jest.setSystemTime(new Date(2026, 9, 29, 9, 30));
      app.chat('Yesterday Chat');
      jest.setSystemTime(new Date(2026, 9, 30, 9, 30));
      app.chat('Today Chat');
      const { view } = app.render();

      const dateOf = (index: number) => {
        const { Text } = require('react-native');
        const texts = app.rtl.within(view.getByTestId(`conversation-item-${index}`)).UNSAFE_getAllByType(Text);
        return String(texts[texts.length - 1].props.children);
      };
      expect(dateOf(0)).toMatch(/9:30/);
      expect(dateOf(1)).toMatch(/9:30/);
      expect(view.getByText('Yesterday')).toBeTruthy();
      expect(dateOf(2)).toMatch(/^Tue/);
      expect(dateOf(3)).toBe('Last week');
      expect(dateOf(4)).toBe('2 weeks ago');
      expect(dateOf(5)).toMatch(/Sep\s*1\b|\b1\s*Sep/);
    });

    it('opening a chat makes it the active one and shows it', async () => {
      const app = boot();
      const id = app.chat('Tap Me');
      app.stores.chat.getState().setActiveConversation(null);
      const { view, route, params } = app.render();

      app.rtl.fireEvent.press(view.getByTestId('conversation-item-0'));

      await app.rtl.waitFor(() => expect(route()).toBe('Chat'));
      expect(params()).toEqual({ conversationId: id });
      expect(app.stores.chat.getState().activeConversationId).toBe(id);
    });
  });

  describe('deleting a chat', () => {
    it('asks first, naming the chat; Cancel keeps it', async () => {
      const app = boot();
      app.chat('Delete Me');
      const { view } = app.render();

      app.rtl.fireEvent.press(view.getByLabelText('Delete Delete Me'));

      expect(view.getByText('Delete Chat')).toBeTruthy();
      expect(view.getByText(/Delete "Delete Me"\? This will also delete all images generated in this chat\./)).toBeTruthy();
      app.rtl.fireEvent.press(view.getByText('Cancel'));
      await app.rtl.waitFor(() => expect(view.queryByText('Delete Chat')).toBeNull());
      expect(view.getByText('Delete Me')).toBeTruthy();
    });

    it('Delete removes the chat and brings back the empty state', async () => {
      const app = boot();
      app.chat('To Delete');
      const { view } = app.render();
      expect(view.getByText('To Delete')).toBeTruthy();

      app.rtl.fireEvent.press(view.getByLabelText('Delete To Delete'));
      await app.rtl.act(async () => { app.rtl.fireEvent.press(view.getByText('Delete')); });

      await app.rtl.waitFor(() => expect(view.queryByText('To Delete')).toBeNull());
      expect(view.getByText('No chats yet')).toBeTruthy();
      expect(app.stores.chat.getState().conversations).toHaveLength(0);
    });
  });
});
