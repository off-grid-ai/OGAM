/**
 * HAPPY-PATH (UI integration) — store-level user flows that don't depend on an inference engine:
 * new chat, new project, delete message. Each drives the REAL store action the UI calls, then renders the
 * REAL surface and asserts what the user sees. No native leaf needed (pure store + render).
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { Conversation, Message } from '../../../src/types';

let mockRouteProjectId = 'proj-x';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { projectId: mockRouteProjectId } }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('happy — store-level flows', () => {
  it('new chat: a created conversation shows in the Recent list', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useChatStore } = require('../../../src/stores');
    const { RecentConversations } = require('../../../src/screens/HomeScreen/components/RecentConversations');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The real action the "new chat" button invokes.
    const id = useChatStore.getState().createConversation('m', 'Trip planning');
    expect(useChatStore.getState().activeConversationId).toBe(id); // becomes active

    const conversations: Conversation[] = useChatStore.getState().conversations;
    const view = render(React.createElement(RecentConversations, {
      conversations, totalCount: conversations.length, focusTrigger: 0,
      onContinueChat: () => {}, onDeleteConversation: () => {}, onSeeAll: () => {},
    }));
    expect(view.getByText('Trip planning')).toBeTruthy();
  });

  it('new project: a created project shows on the Projects screen', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useProjectStore } = require('../../../src/stores');
    const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The real action the "new project" form invokes.
    useProjectStore.getState().createProject({ name: 'Q3 Research', description: '', systemPrompt: '' });
    const view = render(React.createElement(ProjectsScreen, {}));
    expect(view.getByText('Q3 Research')).toBeTruthy();
  });

  it('delete message: a deleted message disappears from the rendered conversation', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useChatStore } = require('../../../src/stores');
    const { ChatMessage } = require('../../../src/components/ChatMessage');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const convId = useChatStore.getState().createConversation('m', 'Chat');
    useChatStore.getState().addMessage(convId, { role: 'user', content: 'keep this one' });
    const toDelete = useChatStore.getState().addMessage(convId, { role: 'user', content: 'delete this one' });

    const renderList = () => {
      const msgs: Message[] = useChatStore.getState().getConversationMessages(convId);
      return render(React.createElement(React.Fragment, {}, ...msgs.map((m: Message) => React.createElement(ChatMessage, { key: m.id, message: m }))));
    };

    const before = renderList();
    expect(before.queryByText('delete this one')).not.toBeNull();
    expect(before.queryByText('keep this one')).not.toBeNull();
    before.unmount();

    // The real action the message "Delete" affordance invokes.
    useChatStore.getState().deleteMessage(convId, toDelete.id);

    const after = renderList();
    expect(after.queryByText('delete this one')).toBeNull();   // gone
    expect(after.queryByText('keep this one')).not.toBeNull(); // sibling survives
  });
});
