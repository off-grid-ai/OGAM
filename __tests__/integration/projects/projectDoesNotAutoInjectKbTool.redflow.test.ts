/**
 * RED-FLOW (integration) — device 2026-07-14: the quick-settings Tools count showed 0, but a project
 * chat reported "Tools sent in request (1)". resolveToolsAndPrompt auto-injected search_knowledge_base
 * for any project chat, so the tools SENT diverged from the tools the user had toggled (the count SHOWS).
 *
 * SPEC (user's decision): never auto-add tools — only the user's toggled set is sent. A project chat with
 * tools off sends NONE. This drives the REAL startGenerationFn (real stores, real resolveToolsAndPrompt)
 * over the llama.rn boundary and asserts what actually reached the model — the same mechanism the sibling
 * orphanChatInjectsKbTool guard uses. (The full-ChatScreen render can't arrive at a project chat through
 * the harness's route adoption, so this asserts at the service the screen calls — the honest level.)
 *
 * RED on HEAD (pre-fix): a REAL project → search_knowledge_base force-injected → present in the sent tools.
 * GREEN: nothing auto-added → the sent request carries no tools.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';
import { createProject } from '../../utils/factories';

describe('project chat does NOT auto-inject search_knowledge_base (red-flow)', () => {
  it('with tools toggled OFF, a chat in a real project sends NO tools to the model', async () => {
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

    // A REAL, existing project (not a deleted/orphan one) — the exact condition that auto-injected KB.
    useProjectStore.setState({ projects: [createProject({ id: 'p1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('txt', 'In project', 'p1');
    useChatStore.getState().addMessage(convId, { role: 'user', content: 'hi' });
    // Tools OFF (makeGenDeps defaults enabledTools: []) — the device state where the popover showed 0.
    const { deps } = makeGenDeps({ activeConversationId: convId });

    boundary.llama!.scriptCompletion({ text: 'Hello there.' });
    await startGenerationFn(deps, { targetConversationId: convId, messageText: 'hi', setDebugInfo: () => {} });

    // What actually reached the model: no search_knowledge_base was force-injected by the project.
    const sentToModel = JSON.stringify(boundary.llama!.calls.completion);
    expect(sentToModel).not.toContain('search_knowledge_base');
    expect(sentToModel).not.toContain('"tools"'); // tools off → the request carries no tools at all
  });
});
