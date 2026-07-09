/**
 * BUG #29(b) regression — sending a second message while a turn is generating must
 * surface a visible "queued" indicator.
 *
 * handleSendFn enqueues the second message via generationService.enqueueMessage when a
 * turn is already generating; useChatScreen subscribes to generationService and projects
 * queuedMessages → queueCount / queuedTexts, which ChatInput's QueueRow renders. This
 * test drives the REAL handleSendFn against the REAL generationService (a real in-flight
 * generation makes isGenerating true) and asserts the second send is enqueued AND that
 * the same subscription the screen uses surfaces a non-zero queued count + the queued
 * text — i.e. the UI has the data to render the indicator.
 *
 * Only the native LLM boundary is faked (a generate that never resolves == a turn still
 * running); the service, its queue, and the subscription run for real.
 * Fails-before / passes-after.
 */
import { generationService } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { activeModelService } from '../../../src/services/activeModelService';
import {
  handleSendFn,
  type GenerationDeps,
  type SendCall,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { resetStores, setupWithConversation, flushPromises } from '../../utils/testHelpers';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');
jest.mock('../../../src/services/modelPreloader', () => ({ abortPreload: jest.fn() }));
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { reclaimSttForGeneration: jest.fn(async () => {}) },
}));

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;

function makeDeps(conversationId: string, over: Partial<GenerationDeps> = {}): GenerationDeps {
  return {
    activeModelId: 'local-model',
    activeModel: { id: 'local-model', name: 'Local', filePath: '/m.gguf' } as any,
    activeModelInfo: { isRemote: false, model: null, modelId: 'local-model', modelName: 'Local' },
    hasActiveModel: true,
    hasTextModel: true,
    supportsToolCalling: false,
    activeConversationId: conversationId,
    activeConversation: null,
    activeProject: null,
    activeImageModel: null,
    imageModelLoaded: false,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: { isGenerating: false } as any,
    settings: { showGenerationDetails: false, imageGenerationMode: 'manual', autoDetectMethod: 'heuristic' } as any,
    downloadedModels: [],
    setAlertState: jest.fn(),
    setIsClassifying: jest.fn(),
    setAppImageGenerationStatus: jest.fn(),
    setAppIsGeneratingImage: jest.fn(),
    addMessage: jest.fn(),
    clearStreamingMessage: jest.fn(),
    deleteConversation: jest.fn(),
    setActiveConversation: jest.fn(),
    removeImagesByConversationId: jest.fn(() => []),
    navigation: { goBack: jest.fn() } as any,
    ensureModelLoaded: jest.fn(async () => ({ ok: true } as any)),
    ensureTextModelForChat: jest.fn(async () => true),
    createConversation: jest.fn(() => conversationId),
    ...over,
  };
}

describe('BUG #29(b) — second send while generating surfaces a queued indicator', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    mockLlm.isModelLoaded.mockReturnValue(true);
    mockLlm.getLoadedModelPath.mockReturnValue('/m.gguf');
    mockLlm.isCurrentlyGenerating.mockReturnValue(false);
    mockLlm.stopGeneration.mockResolvedValue();
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    mockLiteRT.stopGeneration.mockResolvedValue();
    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: true, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    } as any);
    await generationService.stopGeneration().catch(() => {});
  });

  it('enqueues the second message and surfaces queueCount / queuedTexts to the UI subscription', async () => {
    const conversationId = setupWithConversation({ modelId: 'local-model' });

    // A real in-flight generation: the native generate never resolves, so
    // generationService.isGenerating stays true (the turn is still running).
    mockLlm.generateResponse.mockImplementation((() => new Promise(() => {})) as any);

    // Mirror useChatScreen's subscription: project the queue for the UI.
    let queueCount = 0;
    let queuedTexts: string[] = [];
    const unsub = generationService.subscribe(state => {
      queueCount = state.queuedMessages.length;
      queuedTexts = state.queuedMessages.map(m => m.text);
    });

    // First send starts the (hanging) generation.
    const deps = makeDeps(conversationId);
    const startGeneration = async (id: string, _text: string) => { await generationService.generateResponse(id, []); };
    const call: SendCall = { text: 'first message', startGeneration, setDebugInfo: jest.fn() };
    handleSendFn(deps, call); // do not await — it hangs on the in-flight generation
    await flushPromises();

    expect(generationService.getState().isGenerating).toBe(true);
    expect(queueCount).toBe(0); // nothing queued yet

    // Second send WHILE generating → must enqueue (visible feedback), not silently drop.
    await handleSendFn(deps, { text: 'second message', startGeneration, setDebugInfo: jest.fn() });
    await flushPromises();

    expect(generationService.getState().queuedMessages.length).toBe(1);
    // The subscription the screen reads now reflects the queued message → QueueRow renders.
    expect(queueCount).toBe(1);
    expect(queuedTexts).toEqual(['second message']);

    unsub();
  });
});
