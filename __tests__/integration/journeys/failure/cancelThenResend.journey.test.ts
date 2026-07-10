/**
 * FAILURE JOURNEY — cancel a text generation MID-STREAM, then send again.
 *
 * Cluster D. Drives the REAL generationService + REAL chatStore + REAL
 * generationSession. Only the engine (llmService) is faked, and it is DYNAMIC: the
 * first generation streams a few tokens then is CANCELLED mid-stream; the second
 * generation must run to a clean completion. A static engine mock (always completes)
 * could not expose the abort-flag / double-append ordering bug this targets.
 *
 * Terminal artifacts asserted:
 *   - after cancel: streaming state is fully cleared; the partial (if kept) appears
 *     exactly once — never duplicated.
 *   - after the second send: the NEW answer finalizes into exactly one assistant
 *     message; abortRequested from the prior cancel does NOT suppress this finalize
 *     (the "next turn after a cancel never finalizes" bug).
 *   - generationService.wasAborted() reflects the CURRENT turn, not the stale prior one.
 */
import { generationService } from '../../../../src/services/generationService';
import { generationSession } from '../../../../src/services/generationSession';
import { llmService } from '../../../../src/services/llm';
import { liteRTService } from '../../../../src/services/litert';
import { useChatStore } from '../../../../src/stores/chatStore';
import { resetStores, setupWithConversation, flushPromises } from '../../../utils/testHelpers';
import { createMessage } from '../../../utils/factories';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

function assistantMessages(convId: string) {
  const conv = useChatStore.getState().conversations.find(c => c.id === convId);
  return (conv?.messages ?? []).filter(m => m.role === 'assistant');
}

describe('failure journey — cancel mid-stream then resend', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    generationSession._reset();
    mockLlm.isModelLoaded.mockReturnValue(true);
    mockLlm.getLoadedModelPath.mockReturnValue('/mock/model.gguf');
    mockLlm.isCurrentlyGenerating.mockReturnValue(false);
    mockLlm.stopGeneration.mockResolvedValue();
    mockLlm.getPerformanceStats.mockReturnValue({} as any);
    mockLlm.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' } as any);
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    mockLiteRT.stopGeneration.mockResolvedValue();
    await generationService.stopGeneration().catch(() => {});
  });

  it('cancel mid-stream clears state; the NEXT send still finalizes exactly one answer', async () => {
    const convId = setupWithConversation({ modelId: 'm' });
    let onStream1: ((t: string) => void) | null = null;

    // GEN 1: never calls onComplete — it hangs mid-stream until we cancel it.
    mockLlm.generateResponse.mockImplementationOnce(async (_msgs, onStream) => {
      onStream1 = onStream as any;
      onStream1!('Hello');
      onStream1!(' wor');
      // hang: no onComplete — the user cancels.
      return new Promise<string>(() => {});
    });

    const gen1 = generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'hi' })]);
    await flushPromises();
    expect(generationService.getState().isGenerating).toBe(true);

    // USER CANCELS mid-stream.
    await generationService.stopGeneration();
    await flushPromises();

    // Terminal artifact after cancel: not generating; streaming state cleared.
    expect(generationService.getState().isGenerating).toBe(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().streamingForConversationId).toBeNull();
    const afterCancel = assistantMessages(convId);
    // The partial (if kept because trimmed content existed) must appear at most ONCE.
    expect(afterCancel.length).toBeLessThanOrEqual(1);
    void gen1; // gen1 promise never resolves (engine hung) — intentional.

    // GEN 2: the resend — a normal completion. This must finalize even though the
    // prior turn set abortRequested=true; prepareGeneration resets it.
    let onComplete2: (() => void) | null = null;
    mockLlm.generateResponse.mockImplementationOnce(async (_msgs, onStream, onComplete) => {
      (onStream as any)('Fresh answer');
      onComplete2 = onComplete as any;
      return '';
    });

    const partialCount = assistantMessages(convId).length;
    await generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'try again' })]);
    await flushPromises();
    // wasAborted must reflect the CURRENT turn (reset), not the stale cancel.
    expect(generationService.wasAborted()).toBe(false);
    expect(onComplete2).toBeTruthy();
    onComplete2!();
    await flushPromises();

    // Terminal artifact: exactly ONE new assistant message from gen 2, carrying the
    // fresh answer — no double-append, state clean.
    const finalAssistants = assistantMessages(convId);
    expect(finalAssistants.length).toBe(partialCount + 1);
    expect(finalAssistants.at(-1)!.content).toContain('Fresh answer');
    expect(generationService.getState().isGenerating).toBe(false);
  });

  it('cancel with NO streamed content leaves zero assistant messages (no empty bubble)', async () => {
    const convId = setupWithConversation({ modelId: 'm' });
    mockLlm.generateResponse.mockImplementationOnce(async () => {
      // no tokens at all, then hang
      return new Promise<string>(() => {});
    });
    const gen = generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'hi' })]);
    await flushPromises();
    await generationService.stopGeneration();
    await flushPromises();
    void gen;
    expect(assistantMessages(convId).length).toBe(0);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });
});
