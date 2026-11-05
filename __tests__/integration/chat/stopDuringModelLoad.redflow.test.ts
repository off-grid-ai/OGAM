/**
 * RED-FLOW (integration) — hand test 10 (2026-11-05): Stop pressed while "Loading Qwen…" showed
 * "Try again", yet the reply still ran once the model finished loading.
 *
 * Stop ends the generation session; the send and resend paths awaited the model load and then
 * generated without asking whether their turn was still the current one. This drives the REAL
 * startGenerationFn and handleStopFn over the llama.rn boundary, holds the model load open, presses
 * Stop, lets the load finish, and asserts nothing reached the model.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';

describe('Stop during a model load', () => {
  it('the reply that was waiting for the model never runs', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { startGenerationFn, handleStopFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { generationSession } = require('../../../src/services/generationSession');
    const { useChatStore } = require('../../../src/stores');

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');
    const convId = useChatStore.getState().createConversation('txt', '[test] stop while loading');
    useChatStore.getState().addMessage(convId, { role: 'user', content: '[test] hi' });

    let finishLoad: (value: { ok: true }) => void = () => {};
    const { deps } = makeGenDeps({
      activeConversationId: convId,
      ensureModelLoaded: () => new Promise(resolve => { finishLoad = resolve; }),
    });
    boundary.llama!.scriptCompletion({ text: 'This must not appear.' });

    const sending = startGenerationFn(deps, { targetConversationId: convId, messageText: '[test] hi', setDebugInfo: () => {} });
    await Promise.resolve();
    expect(generationSession.isGeneratingFor(convId)).toBe(true);

    await handleStopFn(deps);
    finishLoad({ ok: true });
    await sending;

    expect(boundary.llama!.calls.completion).toHaveLength(0);
    expect(generationSession.isGeneratingFor(convId)).toBe(false);
  });
});
