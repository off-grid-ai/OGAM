/**
 * FAILURE JOURNEY — messages queued while a generation is in flight, drained after it ends.
 *
 * Cluster D (the offline/backpressure edge). Drives the REAL generationService queue
 * with a REAL processor closure. The engine is DYNAMIC: gen 1 hangs (simulating a slow
 * / stalled turn the user keeps typing behind), and only after it completes do the
 * queued messages drain — as ONE combined turn, in order.
 *
 * Terminal artifacts asserted:
 *   - while busy, enqueued messages accumulate (not dropped, not double-processed).
 *   - on completion the queue drains exactly once, combining the queued texts in order.
 *   - a processor error does not leave the queue stuck (logged, state advances).
 */
import { generationService, QueuedMessage } from '../../../../src/services/generationService';
import { llmService } from '../../../../src/services/llm';
import { liteRTService } from '../../../../src/services/litert';
import { resetStores, flushPromises } from '../../../utils/testHelpers';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

describe('failure journey — queued sends drain after the in-flight turn ends', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    mockLlm.isModelLoaded.mockReturnValue(true);
    mockLlm.isCurrentlyGenerating.mockReturnValue(false);
    mockLlm.stopGeneration.mockResolvedValue();
    mockLlm.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' } as any);
    mockLlm.getPerformanceStats.mockReturnValue({} as any);
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    mockLiteRT.stopGeneration.mockResolvedValue();
    await generationService.stopGeneration().catch(() => {});
    generationService.clearQueue();
    generationService.setQueueProcessor(null);
  });

  it('accumulates while busy, then drains ONE combined turn in order', async () => {
    const processed: QueuedMessage[] = [];
    generationService.setQueueProcessor(async (item) => { processed.push(item); });

    let onComplete1: (() => void) | null = null;
    mockLlm.generateResponse.mockImplementationOnce(async (_msgs, _onStream, onComplete) => {
      onComplete1 = onComplete as any; // hang until we fire it
      return '';
    });

    // Start gen 1 (stays in-flight because we hold onComplete1).
    const gen1 = generationService.generateResponse('conv-1', [{ id: 'u', role: 'user', content: 'first', timestamp: 0 } as any]);
    await flushPromises();
    expect(generationService.getState().isGenerating).toBe(true);

    // User keeps sending while busy — these must queue, not run.
    generationService.enqueueMessage({ id: 'q1', conversationId: 'conv-1', text: 'queued A', messageText: 'queued A' });
    generationService.enqueueMessage({ id: 'q2', conversationId: 'conv-1', text: 'queued B', messageText: 'queued B' });
    expect(generationService.getState().queuedMessages).toHaveLength(2);
    expect(processed).toHaveLength(0); // nothing drained while busy

    // Gen 1 finishes → resetState schedules a drain (setTimeout 100ms).
    onComplete1!();
    await new Promise(r => setTimeout(r, 150));
    await flushPromises();
    void gen1;

    // Terminal artifact: drained exactly once, combined in order, queue emptied.
    expect(processed).toHaveLength(1);
    expect(processed[0].text).toBe('queued A\n\nqueued B');
    expect(generationService.getState().queuedMessages).toHaveLength(0);
  });

  it('a processor throw does not leave the queue stuck', async () => {
    generationService.setQueueProcessor(async () => { throw new Error('offline'); });
    generationService.enqueueMessage({ id: 'q', conversationId: 'c', text: 'x', messageText: 'x' });
    // drainQueue runs when not generating; the throw is caught + logged.
    generationService.drainQueue();
    await flushPromises();
    // The queue was consumed (moved out) before the processor ran — not stuck full.
    expect(generationService.getState().queuedMessages).toHaveLength(0);
  });
});
