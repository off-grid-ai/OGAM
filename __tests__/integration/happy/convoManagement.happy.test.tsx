/**
 * HAPPY-PATH (UI integration) — conversation & message management: delete a conversation, move a chat into
 * a project, and edit a message. Each drives the REAL store action the UI invokes and asserts the REAL
 * rendered surface reflects it. No native leaf needed (store + render).
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { Conversation, Message } from '../../../src/types';

let mockRouteProjectId = 'proj-1';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { projectId: mockRouteProjectId } }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('happy — conversation & message management', () => {
  it('delete conversation: it disappears from the Recent list', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useChatStore } = require('../../../src/stores');
    const { RecentConversations } = require('../../../src/screens/HomeScreen/components/RecentConversations');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const keep = useChatStore.getState().createConversation('m', 'Keep me');
    const drop = useChatStore.getState().createConversation('m', 'Delete me');
    const list = () => {
      const conversations: Conversation[] = useChatStore.getState().conversations;
      return render(React.createElement(RecentConversations, { conversations, totalCount: conversations.length, focusTrigger: 0, onContinueChat: () => {}, onDeleteConversation: () => {}, onSeeAll: () => {} }));
    };
    const before = list();
    expect(before.queryByText('Delete me')).not.toBeNull();
    before.unmount();

    useChatStore.getState().deleteConversation(drop);

    const after = list();
    expect(after.queryByText('Delete me')).toBeNull();
    expect(after.queryByText('Keep me')).not.toBeNull();
    void keep;
  });

  it('move to project: setConversationProject files the chat under the project', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useChatStore, useProjectStore } = require('../../../src/stores');
    const { ProjectChatsScreen } = require('../../../src/screens/ProjectChatsScreen');
    const { createProject } = require('../../utils/factories');
    /* eslint-enable @typescript-eslint/no-var-requires */

    mockRouteProjectId = 'proj-1';
    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('m', 'Floating chat'); // unfiled

    const before = render(React.createElement(ProjectChatsScreen, {}));
    expect(before.queryByText('Floating chat')).toBeNull(); // not under the project yet
    before.unmount();

    useChatStore.getState().setConversationProject(convId, 'proj-1');

    const after = render(React.createElement(ProjectChatsScreen, {}));
    expect(after.queryByText('Floating chat')).not.toBeNull(); // now filed under Research
  });

  it('edit message: updated content renders in the conversation', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { useChatStore } = require('../../../src/stores');
    const { ChatMessage } = require('../../../src/components/ChatMessage');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const convId = useChatStore.getState().createConversation('m', 'Chat');
    const msg = useChatStore.getState().addMessage(convId, { role: 'user', content: 'teh capitol of fr±nce' });
    const list = () => {
      const msgs: Message[] = useChatStore.getState().getConversationMessages(convId);
      return render(React.createElement(React.Fragment, {}, ...msgs.map((m: Message) => React.createElement(ChatMessage, { key: m.id, message: m }))));
    };
    const before = list();
    expect(before.queryByText('teh capitol of fr±nce')).not.toBeNull();
    before.unmount();

    useChatStore.getState().updateMessageContent(convId, msg.id, 'the capital of France');

    const after = list();
    expect(after.queryByText('the capital of France')).not.toBeNull();
    expect(after.queryByText('teh capitol of fr±nce')).toBeNull();
  });
});
