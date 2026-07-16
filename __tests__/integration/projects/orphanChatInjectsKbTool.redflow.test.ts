/**
 * RED-FLOW (integration) — Q9b: a chat orphaned by project deletion still force-injects the
 * search_knowledge_base tool for a project whose docs are gone.
 *
 * resolveToolsAndPrompt auto-adds search_knowledge_base whenever conversation.projectId is TRUTHY
 * (useChatGenerationActions.ts:314) — it never checks the project still EXISTS (the resolved `project`
 * at :303 is null for a deleted project but unused at :314). Drives the REAL startGenerationFn (via
 * makeGenDeps + REAL stores); the llama fake records the completion params sent to the model.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';

describe('Q9b — orphaned chat still injects the KB tool (red-flow)', () => {
  it('does not offer search_knowledge_base for a chat whose project was deleted', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { startGenerationFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useProjectStore, useChatStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');

    // Orphaned chat: projectId points at a project that no longer exists (deleted).
    useProjectStore.setState({ projects: [] });
    const convId = useChatStore.getState().createConversation('txt', 'orphan', 'ghost-proj');
    useChatStore.getState().addMessage(convId, { role: 'user', content: 'what did we discuss?' });
    const { deps } = makeGenDeps({ activeConversationId: convId });

    boundary.llama!.scriptCompletion({ text: 'Here is a plain answer.' });
    await startGenerationFn(deps, { targetConversationId: convId, messageText: 'what did we discuss?', setDebugInfo: () => {} });

    // Correct: no project exists, so the KB tool is NOT offered to the model. Today it is force-injected
    // because the check keys on projectId being truthy, not the project existing → RED.
    const sentToModel = JSON.stringify(boundary.llama!.calls.completion);
    expect(sentToModel).not.toContain('search_knowledge_base');
  });
});
