/**
 * PROJECTS ↔ CHATS integration guards: deletion orphaning, re-association, and
 * count/list isolation under the store actions the screens actually call.
 *
 * Drives the REAL projectStore + REAL chatStore together (the two stores the
 * Projects/Chats screens subscribe to). Only AsyncStorage + ragService (native/
 * IO boundaries) are mocked. Deleting or inverting deleteProject /
 * setConversationProject / createConversation fails these tests.
 *
 * The count/list predicate is the SAME one the screens apply inline
 * (`conversations.filter(c => c.projectId === id)`), kept here as the single
 * reference so a screen and this test cannot drift.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

// ragService.deleteProjectDocuments is a native/IO boundary fired on delete.
const mockDeleteProjectDocuments = jest.fn(() => Promise.resolve());
jest.mock('../../../src/services/rag', () => ({
  ragService: { deleteProjectDocuments: (...a: unknown[]) => mockDeleteProjectDocuments(...(a as [])) },
}));

import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';

function chatsForProject(projectId: string) {
  return useChatStore.getState().conversations.filter((c) => c.projectId === projectId);
}
function allChats() {
  return useChatStore.getState().conversations;
}
function projectExists(id: string): boolean {
  return useProjectStore.getState().projects.some((p) => p.id === id);
}

beforeEach(() => {
  mockDeleteProjectDocuments.mockClear();
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useProjectStore.setState({ projects: [] });
});

describe('deleting a project orphans (does not delete) its chats — and they stay reachable', () => {
  it('the chat survives with a now-DANGLING projectId, still in the global chats list, absent from the project list', () => {
    const proj = useProjectStore.getState().createProject({
      name: 'Taxes', description: '', systemPrompt: 'p', icon: '#000',
    } as any);
    const chatId = useChatStore.getState().createConversation('model-1', 'Q4', proj.id);
    expect(chatsForProject(proj.id).map((c) => c.id)).toEqual([chatId]);

    useProjectStore.getState().deleteProject(proj.id);

    // Project gone…
    expect(projectExists(proj.id)).toBe(false);
    // …but the chat still exists (delete alert promises this).
    const conv = allChats().find((c) => c.id === chatId);
    expect(conv).toBeDefined();
    // Its projectId still points at the deleted project — a DANGLING reference.
    // (This is the user-facing risk: the chat is stranded from any project view.)
    expect(conv!.projectId).toBe(proj.id);
    // ProjectDetail for the deleted id would now show it, but the project is
    // unreachable from the Projects list — so the chat can never be re-filed
    // except via the global Chats list. The chat DOES remain in that global list:
    expect(allChats().map((c) => c.id)).toContain(chatId);
    // RAG cleanup for the project was requested.
    expect(mockDeleteProjectDocuments).toHaveBeenCalledWith(proj.id);
  });

  it('deleting project A leaves project B\'s chats fully intact', () => {
    const a = useProjectStore.getState().createProject({ name: 'A', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const b = useProjectStore.getState().createProject({ name: 'B', description: '', systemPrompt: 'p', icon: '#000' } as any);
    useChatStore.getState().createConversation('m', undefined, a.id);
    const b1 = useChatStore.getState().createConversation('m', undefined, b.id);

    useProjectStore.getState().deleteProject(a.id);

    expect(chatsForProject(b.id).map((c) => c.id)).toEqual([b1]);
    expect(projectExists(b.id)).toBe(true);
  });
});

describe('re-association moves a chat between project scopes cleanly', () => {
  it('moving to a new project removes it from the old scope and adds to the new', () => {
    const a = useProjectStore.getState().createProject({ name: 'A', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const b = useProjectStore.getState().createProject({ name: 'B', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const c = useChatStore.getState().createConversation('m', undefined, a.id);

    useChatStore.getState().setConversationProject(c, b.id);

    expect(chatsForProject(a.id)).toHaveLength(0);
    expect(chatsForProject(b.id).map((x) => x.id)).toEqual([c]);
  });

  it('re-filing an ORPHANED chat (project deleted) into a live project rescues it', () => {
    const dead = useProjectStore.getState().createProject({ name: 'Dead', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const live = useProjectStore.getState().createProject({ name: 'Live', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const c = useChatStore.getState().createConversation('m', undefined, dead.id);
    useProjectStore.getState().deleteProject(dead.id);

    // The dangling chat can be re-filed into a live project via the store action.
    useChatStore.getState().setConversationProject(c, live.id);

    expect(chatsForProject(live.id).map((x) => x.id)).toEqual([c]);
    expect(allChats().find((x) => x.id === c)!.projectId).toBe(live.id);
  });

  it('clearing the project (null) files it under Default and out of every project list', () => {
    const a = useProjectStore.getState().createProject({ name: 'A', description: '', systemPrompt: 'p', icon: '#000' } as any);
    const c = useChatStore.getState().createConversation('m', undefined, a.id);

    useChatStore.getState().setConversationProject(c, null);

    expect(chatsForProject(a.id)).toHaveLength(0);
    // projectId cleared to undefined (Default), chat still present globally.
    expect(allChats().find((x) => x.id === c)!.projectId).toBeUndefined();
    expect(allChats()).toHaveLength(1);
  });
});

describe('duplicated project is independent (chats do not follow the copy)', () => {
  it('duplicating a project does NOT duplicate or reassign its chats', () => {
    const a = useProjectStore.getState().createProject({ name: 'A', description: 'd', systemPrompt: 'p', icon: '#000' } as any);
    const c = useChatStore.getState().createConversation('m', undefined, a.id);

    const copy = useProjectStore.getState().duplicateProject(a.id);
    expect(copy).not.toBeNull();

    // The copy is a distinct project with ZERO chats; the original keeps its chat.
    expect(copy!.id).not.toBe(a.id);
    expect(chatsForProject(copy!.id)).toHaveLength(0);
    expect(chatsForProject(a.id).map((x) => x.id)).toEqual([c]);
  });
});
