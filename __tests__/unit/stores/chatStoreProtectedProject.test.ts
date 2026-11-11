const mockSeal = jest.fn(async (..._args: any[]) => undefined);
const mockUnlockedProjects = new Set<string>();
jest.mock('../../../src/stores/protectedProjectStorage', () => ({
  ...jest.requireActual('../../../src/stores/protectedProjectStorage'),
  isProtectedProjectUnlocked: (id: string) => mockUnlockedProjects.has(id),
  sealNewProjectChat: (...args: any[]) => mockSeal(...args),
}));

import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';

const protectedProject = { id: 'therapy', name: 'Locked', description: '', systemPrompt: '', pinVerifier: 'pin:v1:x', protectedBlob: 'atlasitem:v1:c2VhbGVk',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

beforeEach(() => {
  mockSeal.mockClear(); mockUnlockedProjects.clear();
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useProjectStore.setState({ projects: [protectedProject as any] });
});

it('refuses a new chat while the protected project is locked', () => {
  expect(() => useChatStore.getState().createConversation('m', 'x', 'therapy')).toThrow(/Unlock this protected project/);
  expect(mockSeal).not.toHaveBeenCalled();
});

it('creates and seals a chat while the protected project is unlocked', () => {
  mockUnlockedProjects.add('therapy');
  const id = useChatStore.getState().createConversation('m', 'Session 7', 'therapy');
  expect(useChatStore.getState().conversations.find(c => c.id === id)?.projectId).toBe('therapy');
  expect(mockSeal).toHaveBeenCalledWith(id, 'therapy');
});

it('never seals a temporary private chat (it is not saved at all)', () => {
  mockUnlockedProjects.add('therapy');
  useChatStore.getState().createConversation('m', 'Temp', 'therapy', true);
  expect(mockSeal).not.toHaveBeenCalled();
});

describe('moving an existing chat into a protected project', () => {
  const existing = (over: any = {}) => ({ id: 'old', title: 'Notes', modelId: 'm', messages: [], createdAt: 'x', updatedAt: 'x', ...over });

  it('is refused while the project is locked', () => {
    useChatStore.setState({ conversations: [existing() as any] });
    expect(() => useChatStore.getState().setConversationProject('old', 'therapy')).toThrow(/Unlock this protected project/);
    expect(useChatStore.getState().conversations[0].projectId).toBeUndefined();
  });

  it('moves and seals the chat with the project PIN while unlocked', () => {
    mockUnlockedProjects.add('therapy');
    useChatStore.setState({ conversations: [existing() as any] });
    useChatStore.getState().setConversationProject('old', 'therapy');
    expect(useChatStore.getState().conversations[0].projectId).toBe('therapy');
    expect(mockSeal).toHaveBeenCalledWith('old', 'therapy');
  });

  it('keeps a chat that already has its own PIN sealed under that PIN', () => {
    mockUnlockedProjects.add('therapy');
    useChatStore.setState({ conversations: [existing({ pinVerifier: 'own', protectedBlob: 'atlasitem:v1:c2VhbGVk' }) as any] });
    useChatStore.getState().setConversationProject('old', 'therapy');
    expect(mockSeal).not.toHaveBeenCalled();
  });

  it('refuses a temporary private chat', () => {
    mockUnlockedProjects.add('therapy');
    useChatStore.setState({ conversations: [existing({ isPrivate: true }) as any] });
    expect(() => useChatStore.getState().setConversationProject('old', 'therapy')).toThrow(/Temporary private chats/);
  });
});
