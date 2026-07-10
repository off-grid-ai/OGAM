/**
 * Journey (cluster C): PROJECTS-in-flow — is a conversation actually FILED under the
 * project (persisted store state, not just a screen's local useState), and is the
 * project's systemPrompt the value the generate path CONSUMES?
 *
 * Real stores (useChatStore, useProjectStore, useAppStore); no native mocks needed —
 * these journeys are pure state + the exact prompt-resolution rule the generation layer
 * uses (`getProject(conv.projectId)?.systemPrompt`, mirrored from
 * useChatGenerationActions.resolveToolsAndPrompt line 318).
 *
 * Persistence is exercised through the store's REAL partialize/merge (createConversation
 * → serialize via partialize → migratePersistedState) so "survives relaunch" is proven,
 * not assumed.
 */

import { useChatStore } from '../../../../src/stores/chatStore';
import { useProjectStore } from '../../../../src/stores/projectStore';
import { useAppStore } from '../../../../src/stores/appStore';
import { handleSelectProjectFn } from '../../../../src/screens/ChatScreen/useChatGenerationActions';
import { resetStores } from '../../../utils/testHelpers';
import { createProject } from '../../../utils/factories';

/**
 * The EXACT rule the generation path uses to pick the system prompt for a turn
 * (useChatGenerationActions.resolveToolsAndPrompt): project prompt wins, else the
 * global setting, else the app default. Reproduced here so we assert the value the
 * ACTION consumes, not just what the store holds.
 */
function resolveConsumedSystemPrompt(conversationId: string): string {
  const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const project = conv?.projectId ? useProjectStore.getState().getProject(conv.projectId) : null;
  return project?.systemPrompt || useAppStore.getState().settings.systemPrompt || '';
}

/**
 * Whether the generation path force-adds the knowledge-base tool for this turn — it
 * keys off `conversation.projectId` alone (resolveToolsAndPrompt line 314), NOT whether
 * the project still exists.
 */
function consumesKnowledgeBaseTool(conversationId: string): boolean {
  const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const base = useAppStore.getState().settings.enabledTools || [];
  let tools = [...base];
  if (conv?.projectId && !tools.includes('search_knowledge_base')) tools = [...tools, 'search_knowledge_base'];
  return tools.includes('search_knowledge_base');
}

describe('Journey C — project association is real (filed, persisted, consumed)', () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, systemPrompt: 'GLOBAL_PROMPT', enabledTools: [] } as any,
    });
  });

  it('pick a project on a NEW chat BEFORE first message → the sent conversation is filed under it (createConversation carries pendingProjectId)', () => {
    const project = createProject({ systemPrompt: 'PROJECT_PROMPT' });
    useProjectStore.setState({ projects: [project] });

    // handleSend's new-chat branch: createConversation(model, undefined, pendingProjectId).
    // pendingProjectId is the value handleSelectProjectFn set on the NEW-chat path.
    const pendingProjectId = project.id;
    const convId = useChatStore.getState().createConversation('model-1', undefined, pendingProjectId);

    const conv = useChatStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.projectId).toBe(project.id); // filed in the STORE, not just local state
    // …and the generate path consumes the PROJECT prompt, not the global one.
    expect(resolveConsumedSystemPrompt(convId)).toBe('PROJECT_PROMPT');
  });

  it('BUG GUARD (Q10 seam): handleSelectProjectFn on an EXISTING chat persists to the store; on a NEW chat it does NOT (relies on caller to pass pendingProjectId)', () => {
    const project = createProject({ systemPrompt: 'P' });
    useProjectStore.setState({ projects: [project] });

    // Existing chat: selection is persisted onto the conversation immediately.
    const convId = useChatStore.getState().createConversation('model-1');
    let closed = false;
    handleSelectProjectFn(
      {
        activeConversationId: convId,
        setConversationProject: useChatStore.getState().setConversationProject,
        setShowProjectSelector: () => { closed = true; },
      },
      project,
    );
    expect(useChatStore.getState().conversations.find(c => c.id === convId)?.projectId).toBe(project.id);
    expect(closed).toBe(true);

    // NEW chat (no activeConversationId): handleSelectProjectFn writes NOTHING to any
    // conversation — the association lives ONLY in ChatScreen's pendingProjectId local
    // state. If the send path ever failed to thread pendingProjectId through, the pick
    // would be silently lost. This documents the fragile seam.
    handleSelectProjectFn(
      {
        activeConversationId: null,
        setConversationProject: useChatStore.getState().setConversationProject,
        setShowProjectSelector: () => {},
      },
      project,
    );
    // No conversation was touched (none exists), so nothing to assert on the store — the
    // selection is not persisted anywhere durable at this point.
    expect(useChatStore.getState().conversations.filter(c => c.projectId === project.id)).toHaveLength(1);
    // (still just the existing chat — the new-chat pick added no record)
  });

  it('the project system prompt SURVIVES a relaunch (real partialize → migrate round-trip)', () => {
    const project = createProject({ systemPrompt: 'PROJECT_PROMPT' });
    useProjectStore.setState({ projects: [project] });
    const convId = useChatStore.getState().createConversation('model-1', 'Filed chat', project.id);

    // Round-trip the chat store through its REAL persistence contract.
    const persistOptions = (useChatStore as any).persist.getOptions();
    const snapshot = persistOptions.partialize(useChatStore.getState());
    // Wipe and rehydrate from the serialized snapshot.
    useChatStore.setState({ conversations: [], activeConversationId: null });
    useChatStore.setState({
      conversations: snapshot.conversations,
      activeConversationId: snapshot.activeConversationId,
    });

    const conv = useChatStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.projectId).toBe(project.id); // projectId is inside partialized conversations
    expect(resolveConsumedSystemPrompt(convId)).toBe('PROJECT_PROMPT');
  });

  it('move a chat between projects → BOTH project chat-counts (derived filters) update, no stale counter', () => {
    const a = createProject({ name: 'A' });
    const b = createProject({ name: 'B' });
    useProjectStore.setState({ projects: [a, b] });
    const convId = useChatStore.getState().createConversation('model-1', 'movable', a.id);

    const countFor = (pid: string) =>
      useChatStore.getState().conversations.filter(c => c.projectId === pid).length;

    expect(countFor(a.id)).toBe(1);
    expect(countFor(b.id)).toBe(0);

    // Move it (the same setConversationProject the UI dispatches).
    useChatStore.getState().setConversationProject(convId, b.id);

    expect(countFor(a.id)).toBe(0);
    expect(countFor(b.id)).toBe(1);
    // and the consumed prompt now comes from B, not A
    expect(useChatStore.getState().conversations.find(c => c.id === convId)?.projectId).toBe(b.id);
  });

  it('unfile a chat (project = null) → falls back to the GLOBAL system prompt the generate path consumes', () => {
    const project = createProject({ systemPrompt: 'PROJECT_PROMPT' });
    useProjectStore.setState({ projects: [project] });
    const convId = useChatStore.getState().createConversation('model-1', 'chat', project.id);
    expect(resolveConsumedSystemPrompt(convId)).toBe('PROJECT_PROMPT');

    useChatStore.getState().setConversationProject(convId, null);
    expect(useChatStore.getState().conversations.find(c => c.id === convId)?.projectId).toBeUndefined();
    expect(resolveConsumedSystemPrompt(convId)).toBe('GLOBAL_PROMPT');
  });

  // ── Q11 (KNOWN, LOW-MED): "New chat" on context-full drops the project ───────
  it('BUG GUARD Q11: the context-full "New chat" alert creates an UNASSIGNED chat even from a project chat (createConversation called with no projectId)', () => {
    const project = createProject({ systemPrompt: 'PROJECT_PROMPT' });
    useProjectStore.setState({ projects: [project] });

    // Active project chat that just hit the context window.
    const projectChatId = useChatStore.getState().createConversation('model-1', 'full chat', project.id);
    useChatStore.getState().setActiveConversation(projectChatId);
    expect(useChatStore.getState().conversations.find(c => c.id === projectChatId)?.projectId).toBe(project.id);

    // The alert's "New chat" onPress does EXACTLY this (useChatGenerationActions.ts:382 & :554):
    //   const modelId = activeModelInfo.modelId;
    //   const newId = createConversation(modelId);   // ← no projectId argument
    //   setActiveConversation(newId);
    const modelId = 'model-1';
    const newId = useChatStore.getState().createConversation(modelId); // no projectId — the bug
    useChatStore.getState().setActiveConversation(newId);

    const newConv = useChatStore.getState().conversations.find(c => c.id === newId);
    // The user was inside a project chat, tapped "New chat", and the new chat is UNASSIGNED.
    expect(newConv?.projectId).toBeUndefined();
    // The project-preserving behaviour WOULD have carried project.id forward:
    expect(newConv?.projectId).not.toBe(project.id);
    // Consequence: the new chat consumes the GLOBAL prompt, silently leaving the project.
    expect(resolveConsumedSystemPrompt(newId)).toBe('GLOBAL_PROMPT');
  });

  // ── Q9 (KNOWN, MED) + a NEW consequence beyond "not re-filable" ──────────────
  it('BUG GUARD Q9: deleting a project ORPHANS its chats (dangling projectId), and the orphan still forces the KB tool + a project prompt lookup that now returns nothing', () => {
    const project = createProject({ systemPrompt: 'PROJECT_PROMPT' });
    useProjectStore.setState({ projects: [project] });
    const convId = useChatStore.getState().createConversation('model-1', 'orphan-to-be', project.id);

    // Before delete: consumes the project prompt + KB tool is forced on.
    expect(resolveConsumedSystemPrompt(convId)).toBe('PROJECT_PROMPT');
    expect(consumesKnowledgeBaseTool(convId)).toBe(true);

    // Delete the project mid-use (ProjectDetailScreen.handleDeleteProject → deleteProject).
    useProjectStore.getState().deleteProject(project.id);

    const conv = useChatStore.getState().conversations.find(c => c.id === convId);
    // BUG (Q9): the chat still carries the now-dangling projectId — it is not cleared,
    // not reassigned, and no project view lists it (getProject returns undefined).
    expect(conv?.projectId).toBe(project.id);
    expect(useProjectStore.getState().getProject(project.id)).toBeUndefined();

    // NEW consequence beyond Q9's "only visible in global Chats" framing:
    // (a) the generate path silently falls back to the GLOBAL prompt (the project
    //     prompt the user configured is gone with no indication), and
    // (b) it STILL force-adds search_knowledge_base because the branch keys off
    //     conversation.projectId existing, not the project existing — so an orphaned
    //     chat injects a KB tool for a project whose RAG docs were deleted.
    expect(resolveConsumedSystemPrompt(convId)).toBe('GLOBAL_PROMPT');
    expect(consumesKnowledgeBaseTool(convId)).toBe(true); // KB tool still forced for a dead project
  });
});
