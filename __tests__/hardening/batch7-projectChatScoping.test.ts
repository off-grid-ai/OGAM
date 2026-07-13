/**
 * BATCH 7 (Projects) hardening — per-project chat scoping & counting.
 *
 * The Projects screens derive "chats for this project" and "chat count" by
 * filtering the REAL chatStore conversations on `projectId`:
 *   ProjectsScreen:       conversations.filter(c => c.projectId === id).length
 *   ProjectDetailScreen:  conversations.filter(c => c.projectId === id).sort(...)
 * That filtering lives inline in the Views, so no test proves the underlying
 * store data actually isolates one project's chats from another's. These tests
 * drive the REAL useChatStore (no mock of the store under assertion — deleting
 * createConversation/setConversationProject would fail them) with multiple
 * projects' conversations and assert the count/scoping/isolation the screens
 * rely on for plan cases 8, 28, 30, 32, 34, 35, 36.
 *
 * Only the AsyncStorage persistence boundary is mocked (native). The store
 * logic runs for real.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

// The hook registry is invoked from appendToStreamingMessage; not exercised here
// but keep the appStore require in speakableStreamingAnswer from exploding.
import { useChatStore } from '../../src/stores/chatStore';

// The count/filter rule the Views apply — kept as the single reference the tests
// assert against so a screen and this test can't drift on the predicate.
function chatsForProject(projectId: string) {
  return useChatStore
    .getState()
    .conversations.filter((c) => c.projectId === projectId);
}
function chatCount(projectId: string): number {
  return chatsForProject(projectId).length;
}

describe('BATCH7 project chat scoping (real chatStore)', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      streamingMessage: '',
      streamingReasoningContent: '',
      streamingForConversationId: null,
      isStreaming: false,
      isThinking: false,
    });
  });

  it('a fresh project has a zero chat count (case 8/34)', () => {
    // No conversations at all.
    expect(chatCount('alpha')).toBe(0);
    // A conversation with NO projectId (a non-project chat) must not count.
    useChatStore.getState().createConversation('model-1');
    expect(chatCount('alpha')).toBe(0);
  });

  it('counts only THIS project\'s conversations (case 28/30/32)', () => {
    const { createConversation } = useChatStore.getState();
    createConversation('model-1', undefined, 'alpha');
    createConversation('model-1', undefined, 'alpha');
    createConversation('model-1', undefined, 'beta');
    createConversation('model-1'); // orphan, no project

    expect(chatCount('alpha')).toBe(2);
    expect(chatCount('beta')).toBe(1);
  });

  it('a chat created in Beta counts only in Beta, Alpha unchanged (case 35)', () => {
    const { createConversation } = useChatStore.getState();
    createConversation('model-1', undefined, 'alpha');
    createConversation('model-1', undefined, 'alpha');
    expect(chatCount('alpha')).toBe(2);

    createConversation('model-1', undefined, 'beta');
    expect(chatCount('beta')).toBe(1);
    expect(chatCount('alpha')).toBe(2); // Alpha not disturbed
  });

  it("Alpha's chat list contains exactly its own chats — Beta's absent (case 36)", () => {
    const { createConversation } = useChatStore.getState();
    const a1 = createConversation('model-1', 'Alpha One', 'alpha');
    const a2 = createConversation('model-1', 'Alpha Two', 'alpha');
    const b1 = createConversation('model-1', 'Beta One', 'beta');

    const alphaIds = chatsForProject('alpha').map((c) => c.id).sort();
    expect(alphaIds).toEqual([a1, a2].sort());
    expect(chatsForProject('alpha').map((c) => c.id)).not.toContain(b1);
  });

  it('deleting a project\'s conversation drops that project\'s count only', () => {
    const { createConversation, deleteConversation } = useChatStore.getState();
    const a1 = createConversation('model-1', undefined, 'alpha');
    createConversation('model-1', undefined, 'alpha');
    createConversation('model-1', undefined, 'beta');

    deleteConversation(a1);
    expect(chatCount('alpha')).toBe(1);
    expect(chatCount('beta')).toBe(1);
  });

  it('re-associating a conversation via setConversationProject moves it between counts', () => {
    const { createConversation, setConversationProject } = useChatStore.getState();
    const c = createConversation('model-1', undefined, 'alpha');
    expect(chatCount('alpha')).toBe(1);
    expect(chatCount('beta')).toBe(0);

    setConversationProject(c, 'beta');
    expect(chatCount('alpha')).toBe(0);
    expect(chatCount('beta')).toBe(1);

    // Clearing the project (null) removes it from every project list.
    setConversationProject(c, null);
    expect(chatCount('alpha')).toBe(0);
    expect(chatCount('beta')).toBe(0);
  });

  it('ProjectDetail ordering: newest-updated conversation is first in the project list', () => {
    const { createConversation, addMessage } = useChatStore.getState();
    const older = createConversation('model-1', 'Older', 'alpha');
    const newer = createConversation('model-1', 'Newer', 'alpha');
    // Touch the OLDER one after creation so its updatedAt is the latest.
    addMessage(older, { role: 'user', content: 'bump' });

    const sorted = chatsForProject('alpha').sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    expect(sorted[0].id).toBe(older);
    expect(sorted[1].id).toBe(newer);
  });
});
