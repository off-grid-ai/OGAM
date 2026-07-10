/**
 * JOURNEY: start a generation → cancel mid-stream → the partial answer is SAVED (not lost)
 * → the state is clean so the next send/resend runs.
 *
 * Cluster D (interrupt/recovery). Crosses the REAL generationService + REAL chatStore, mocking
 * ONLY the native llm boundary. Asserts the TERMINAL artifacts: the persisted assistant
 * message (partial content the user keeps) and the reset streaming/generating state (so the
 * UI isn't wedged and a resend can start).
 *
 * The failure edge attacked: a mid-stream cancel that must (a) persist the partial, (b) clear
 * isGenerating/streaming so nothing is stuck, and (c) NOT strand an empty assistant bubble
 * when zero tokens streamed.
 */
import { useAppStore } from '../../../src/stores/appStore';
import { generationService } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { activeModelService } from '../../../src/services/activeModelService';
import {
  resetStores, setupWithActiveModel, setupWithConversation, flushPromises, getChatState,
} from '../../utils/testHelpers';
import { createMessage, createDownloadedModel } from '../../utils/factories';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;

describe('JOURNEY: cancel mid-generation → partial saved → resend clean', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    mockLlm.isModelLoaded.mockReturnValue(true);
    mockLlm.getLoadedModelPath.mockReturnValue('/mock/model.gguf');
    mockLlm.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' });
    mockLlm.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 10, lastDecodeTokensPerSecond: 12, lastTimeToFirstToken: 0.5,
      lastGenerationTime: 2, lastTokenCount: 20,
    });
    mockLlm.stopGeneration.mockResolvedValue();
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    mockLiteRT.stopGeneration.mockResolvedValue();
    mockActive.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: true, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    });
    await generationService.stopGeneration().catch(() => {});
  });

  it('saves the partial answer and clears state when cancelled mid-stream', async () => {
    const modelId = setupWithActiveModel();
    const conversationId = setupWithConversation({ modelId });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: modelId })], activeModelId: modelId });

    let streamCb: any = null;
    mockLlm.generateResponse.mockImplementation(async (_m, onStream) => {
      streamCb = onStream!;
      return new Promise(() => {}); // never completes → we cancel it
    });

    const messages = [createMessage({ role: 'user', content: 'write a long essay' })];
    generationService.generateResponse(conversationId, messages);
    await flushPromises();

    // Stream a partial answer, then the user hits stop.
    streamCb?.('The quick brown fox');
    await flushPromises();
    const partial = await generationService.stopGeneration();

    // TERMINAL artifacts:
    expect(partial).toBe('The quick brown fox');
    const chat = getChatState();
    expect(chat.isStreaming).toBe(false);
    expect(chat.streamingForConversationId).toBeNull();
    expect(generationService.getState().isGenerating).toBe(false);
    // The partial answer is persisted as an assistant message (not lost).
    const conv = chat.conversations.find(c => c.id === conversationId);
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0].role).toBe('assistant');
    expect(conv?.messages[0].content).toBe('The quick brown fox');
  });

  it('does NOT strand an empty assistant bubble when cancelled before any token', async () => {
    const modelId = setupWithActiveModel();
    const conversationId = setupWithConversation({ modelId });

    mockLlm.generateResponse.mockImplementation(async () => new Promise(() => {}));
    generationService.generateResponse(conversationId, [createMessage({ role: 'user', content: 'hi' })]);
    await flushPromises();

    await generationService.stopGeneration(); // cancel with zero tokens

    const conv = getChatState().conversations.find(c => c.id === conversationId);
    expect(conv?.messages).toHaveLength(0); // TERMINAL: nothing stranded
    expect(generationService.getState().isGenerating).toBe(false);
  });

  it('after a cancel, a fresh generation on the same conversation runs to completion', async () => {
    const modelId = setupWithActiveModel();
    const conversationId = setupWithConversation({ modelId });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: modelId })], activeModelId: modelId });

    // First generation: cancelled after a partial.
    let firstStream: any = null;
    mockLlm.generateResponse.mockImplementationOnce(async (_m, onStream) => {
      firstStream = onStream!;
      return new Promise(() => {});
    });
    generationService.generateResponse(conversationId, [createMessage({ role: 'user', content: 'q1' })]);
    await flushPromises();
    firstStream?.('partial');
    await flushPromises();
    await generationService.stopGeneration();

    // Second generation: completes normally. State must not be wedged from the cancel.
    let secondStream: any = null;
    let secondComplete: any = null;
    mockLlm.generateResponse.mockImplementationOnce(async (_m, onStream, onComplete) => {
      secondStream = onStream!;
      secondComplete = onComplete!;
      return 'full answer';
    });
    const p = generationService.generateResponse(conversationId, [createMessage({ role: 'user', content: 'q2' })]);
    await flushPromises();
    secondStream?.('full answer');
    await flushPromises();
    secondComplete?.('');
    await p;

    // TERMINAL: the second turn's answer is persisted; no leftover generating state.
    const conv = getChatState().conversations.find(c => c.id === conversationId);
    const contents = conv?.messages.map(m => m.content) ?? [];
    expect(contents).toContain('full answer');
    expect(generationService.getState().isGenerating).toBe(false);
  });
});
