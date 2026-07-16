/**
 * RED-FLOW (integration) — Q11: "New chat" on a context-full alert drops the project.
 *
 * In a project chat, when generation overflows the context window the app offers a "New chat" action;
 * its handler calls createConversation(modelId) with NO projectId (useChatGenerationActions.ts:382), so
 * the continuation chat is unfiled from the project. Drives the REAL startGenerationFn (via makeGenDeps
 * wired to the REAL stores) with a llama that throws a context-overflow error, captures the alert the
 * user sees, and invokes its "New chat" button.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';
import { createProject } from '../../utils/factories';

describe('Q11 — context-full "New chat" drops the project (red-flow)', () => {
  it('creates the continuation chat inside the same project', async () => {
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

    // A chat filed under a project.
    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('txt', 'In project', 'proj-1');
    useChatStore.getState().addMessage(convId, { role: 'user', content: 'continue please' });
    const { deps, captured } = makeGenDeps({ activeConversationId: convId });

    // Generation overflows the context window → the context-full alert is raised.
    boundary.llama!.scriptCompletion({ throwMessage: 'the input prompt is too long for this context window' });
    await startGenerationFn(deps, { targetConversationId: convId, messageText: 'continue please', setDebugInfo: () => {} });

    // The user taps "New chat" on that alert.
    const alert = captured.alerts.find(a => a.buttons?.some(b => b.text === 'New chat'));
    expect(alert).toBeDefined();
    const before = new Set(useChatStore.getState().conversations.map((c: { id: string }) => c.id));
    alert!.buttons!.find(b => b.text === 'New chat')!.onPress!();

    // Correct: the continuation chat inherits the project. Today createConversation(modelId) omits the
    // projectId, so the new chat is unfiled → RED.
    const newConv = useChatStore.getState().conversations.find((c: { id: string }) => !before.has(c.id));
    expect(newConv).toBeDefined();
    expect((newConv as { projectId?: string }).projectId).toBe('proj-1');
  });
});
