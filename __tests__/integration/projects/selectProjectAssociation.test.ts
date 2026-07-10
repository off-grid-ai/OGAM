/**
 * PROJECT SELECTION → conversation association guard.
 *
 * Exercises the REAL `handleSelectProjectFn` (the handler the ProjectSelectorSheet
 * dispatches) wired to the REAL chatStore.setConversationProject. Proves the exact
 * value the store ends up with — the conversation's projectId — after the user
 * picks a project from the sheet.
 *
 * It also documents the CONFIRMED gap: when there is NO active conversation yet
 * (a brand-new chat, before the first message is sent), handleSelectProjectFn is a
 * no-op on the store — the association lives only in the ChatScreen's local
 * `pendingProjectId` state, so any create path that forgets to pass pendingProjectId
 * strands the user's choice. This test pins the store-side behaviour so a change to
 * that contract is caught.
 *
 * Only AsyncStorage (native) is mocked; the store + handler run for real.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { handleSelectProjectFn, type SelectProjectDeps } from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { useChatStore } from '../../../src/stores/chatStore';
import type { Project } from '../../../src/types';

const PROJECT_A = { id: 'proj-a', name: 'A', description: '', systemPrompt: 'p', icon: '#000', createdAt: '', updatedAt: '' } as Project;

function convProjectId(id: string): string | undefined {
  return useChatStore.getState().conversations.find((c) => c.id === id)?.projectId;
}

let sheetClosed = false;
function makeDeps(activeConversationId: string | null): SelectProjectDeps {
  sheetClosed = false;
  return {
    activeConversationId,
    setConversationProject: useChatStore.getState().setConversationProject,
    setShowProjectSelector: ((v: boolean) => { sheetClosed = v === false; }) as SelectProjectDeps['setShowProjectSelector'],
  };
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

describe('selecting a project for an EXISTING conversation writes through to the store', () => {
  it('picking a project sets the conversation projectId; the sheet closes', () => {
    const c = useChatStore.getState().createConversation('m'); // no project yet
    expect(convProjectId(c)).toBeUndefined();

    handleSelectProjectFn(makeDeps(c), PROJECT_A);

    expect(convProjectId(c)).toBe('proj-a');
    expect(sheetClosed).toBe(true);
  });

  it('picking "Default" (null) clears the conversation projectId', () => {
    const c = useChatStore.getState().createConversation('m', undefined, 'proj-a');
    expect(convProjectId(c)).toBe('proj-a');

    handleSelectProjectFn(makeDeps(c), null);

    expect(convProjectId(c)).toBeUndefined();
  });
});

describe('CONFIRMED GAP: no active conversation → store association is a no-op', () => {
  it('picking a project with no active conversation does NOT create/associate anything in the store', () => {
    handleSelectProjectFn(makeDeps(null), PROJECT_A);

    // No conversation exists and none was created; the choice lives only in the
    // ChatScreen local pendingProjectId, not the store. The sheet still closes.
    expect(useChatStore.getState().conversations).toHaveLength(0);
    expect(sheetClosed).toBe(true);
  });
});
