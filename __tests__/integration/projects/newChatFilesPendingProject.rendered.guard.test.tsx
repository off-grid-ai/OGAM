/**
 * GUARD (UI, rendered) — Q10 at the pixel: sending the first message on a brand-new chat with a project
 * pending files the conversation under that project, and it SHOWS in the project's chat list.
 *
 * Real handleSendFn threads deps.pendingProjectId into chatStore.createConversation; then the REAL
 * ProjectChatsScreen is mounted over the real stores. GREEN regression guard: the new "New Conversation"
 * appears under "Research". If a future change drops pendingProjectId on the send path, the chat won't be
 * listed here and this fails.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';
import { createProject } from '../../utils/factories';

let mockRouteProjectId = 'proj-1';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { projectId: mockRouteProjectId } }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('Q10 (rendered) — new chat files a pending project', () => {
  it('lists the new conversation under the pending project after first send', async () => {
    mockRouteProjectId = 'proj-1';
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = require('../../harness/nativeBoundary').requireRTL();
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { handleSendFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useProjectStore } = require('../../../src/stores');
    const { ProjectChatsScreen } = require('../../../src/screens/ProjectChatsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');

    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    // Brand-new chat: no active conversation, but the user picked a project (pendingProjectId).
    const { deps } = makeGenDeps({ activeConversationId: null, pendingProjectId: 'proj-1' });

    // Precondition: the project has no chats yet (empty state renders).
    const before = render(React.createElement(ProjectChatsScreen, {}));
    expect(before.getByText('No chats yet')).toBeTruthy();
    before.unmount();

    await handleSendFn(deps, { text: 'hello there', startGeneration: async () => {}, setDebugInfo: () => {} });

    const view = render(React.createElement(ProjectChatsScreen, {}));
    // The freshly-sent chat is filed under the project and shows in its list (titled from the first message).
    expect(view.queryByText('No chats yet')).toBeNull();
    expect(view.getByText('hello there')).toBeTruthy();
  });
});
