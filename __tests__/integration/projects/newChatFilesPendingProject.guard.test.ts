/**
 * GUARD (integration) — Q10: sending the first message on a brand-new chat with a project pending files
 * the conversation under that project.
 *
 * Drives the REAL handleSendFn (via makeGenDeps + REAL stores). This is a GREEN regression guard: the
 * send path DOES thread deps.pendingProjectId into createConversation (useChatGenerationActions.ts:461),
 * so a future change can't silently drop it. (The residual Q10 risk — the ChatScreen picker not SETTING
 * pendingProjectId on a new chat — is component-level UI wiring, outside this send-path guard.)
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';
import { createProject } from '../../utils/factories';

describe('Q10 — new chat files a pending project (guard)', () => {
  it('files the new conversation under the pending project on first send', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { handleSendFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useProjectStore, useChatStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');

    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    // Brand-new chat: no active conversation, but the user picked a project (pendingProjectId).
    const { deps } = makeGenDeps({ activeConversationId: null, pendingProjectId: 'proj-1' });

    const before = new Set(useChatStore.getState().conversations.map((c: { id: string }) => c.id));
    await handleSendFn(deps, { text: 'hello there', startGeneration: async () => {}, setDebugInfo: () => {} });

    const newConv = useChatStore.getState().conversations.find((c: { id: string }) => !before.has(c.id));
    expect(newConv).toBeDefined();
    expect((newConv as { projectId?: string }).projectId).toBe('proj-1');
  });
});
