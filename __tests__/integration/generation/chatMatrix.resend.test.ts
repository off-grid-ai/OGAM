/**
 * ADVERSARIAL intersection matrix: RESEND / REGENERATE across engine × recorded
 * turn kind.
 *
 * Axes:
 *   engine           = { llama (GGUF), litert (LiteRT), remote (gateway) }
 *   recorded turn    = { text turn, image turn }
 *   flow             = resend / regenerate
 *
 * The seam under test is regenerateResponseFn (src/screens/ChatScreen/
 * useChatGenerationActions.ts): it re-classifies the resent user prompt and
 * dispatches to EITHER the image pipeline OR text generation. The high-risk
 * cell (has broken in production): resending an IMAGE turn must re-DRAW an image,
 * not fall back to text.
 *
 * We assert the CONSEQUENCE of the routing verdict — WHICH pipeline actually ran
 * — never merely "a gate was called":
 *   - image resend  → imageGenerationService.generateImage ran with the prompt,
 *                      and text generation did NOT run.
 *   - text resend   → text generation ran, and the image pipeline did NOT run.
 * Both the TRUE and FALSE branches of the image-routing gate are exercised, per
 * the "test the verdict's false branch" rule. The engine axis is threaded
 * through activeModel.engine + the remote-server store so the resend path is
 * proven for llama, litert (which additionally rewinds native history), and
 * remote — not just the llama default.
 */

import {
  regenerateResponseFn,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { generationSession } from '../../../src/services/generationSession';
import { createDownloadedModel, createMessage } from '../../utils/factories';

// ── Boundary mocks (native / heavy services). The routing logic under test runs
//    for real; only the leaf pipelines it dispatches to are stubbed so we can
//    observe which one ran. ──
jest.mock('../../../src/services/huggingface', () => ({ huggingFaceService: {} }));
jest.mock('../../../src/services/modelManager', () => ({ modelManager: {} }));
jest.mock('../../../src/services/hardware', () => ({ hardwareService: {} }));
jest.mock('../../../src/services/backgroundDownloadService', () => ({ backgroundDownloadService: {} }));
jest.mock('../../../src/services/activeModelService/index', () => ({
  activeModelService: { loadTextModel: jest.fn(), unloadTextModel: jest.fn() },
}));
jest.mock('../../../src/services/intentClassifier', () => ({
  intentClassifier: { classifyIntent: jest.fn() },
  classifyToolsNeeded: jest.fn(() => []),
}));
jest.mock('../../../src/services/generationService', () => ({
  generationService: {
    generateResponse: jest.fn(),
    generateWithTools: jest.fn(),
    stopGeneration: jest.fn(),
    enqueueMessage: jest.fn(),
    drainQueue: jest.fn(),
    getState: jest.fn(() => ({ isGenerating: false })),
    wasAborted: jest.fn(() => false),
  },
}));
jest.mock('../../../src/services/imageGenerationService', () => ({
  imageGenerationService: {
    generateImage: jest.fn(),
    cancelGeneration: jest.fn(),
    getState: jest.fn(() => ({ isGenerating: false })),
  },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    getLoadedModelPath: jest.fn(() => '/path/model.gguf'),
    isModelLoaded: jest.fn(() => true),
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
    isGemma4Model: jest.fn(() => false),
    isThinkingEnabled: jest.fn(() => false),
    stopGeneration: jest.fn(),
    getContextDebugInfo: jest.fn(),
    clearKVCache: jest.fn(),
    generateResponse: jest.fn(),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: {
    isModelLoaded: jest.fn(() => true),
    invalidateConversation: jest.fn(),
    stopGeneration: jest.fn(),
  },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: { deleteGeneratedImage: jest.fn() },
}));
jest.mock('../../../src/services/rag', () => ({
  ragService: {
    searchProject: jest.fn(() => Promise.resolve({ chunks: [], truncated: false })),
    getDocumentsByProject: jest.fn(() => Promise.resolve([])),
  },
  retrievalService: { formatForPrompt: jest.fn(() => '') },
}));
jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: { isLoaded: jest.fn(() => false), load: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../../../src/services/contextCompaction', () => ({
  contextCompactionService: {
    isContextFullError: jest.fn(() => false),
    compact: jest.fn(),
    clearSummary: jest.fn(),
  },
}));
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { reclaimSttForGeneration: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message?: string, buttons?: any[]) => ({ visible: true, title, message, buttons: buttons || [] })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));
jest.mock('../../../src/constants', () => ({
  APP_CONFIG: { defaultSystemPrompt: 'You are a helpful assistant.' },
}));

const { intentClassifier } = require('../../../src/services/intentClassifier');
const { generationService } = require('../../../src/services/generationService');
const { imageGenerationService } = require('../../../src/services/imageGenerationService');
const { liteRTService } = require('../../../src/services/litert');

const mockClassifyIntent = intentClassifier.classifyIntent as jest.Mock;
const mockGenerateResponse = generationService.generateResponse as jest.Mock;
const mockGenerateWithTools = generationService.generateWithTools as jest.Mock;
const mockGenerateImage = imageGenerationService.generateImage as jest.Mock;
const mockInvalidateConversation = liteRTService.invalidateConversation as jest.Mock;

const mockChatStoreGetState = jest.fn(() => ({ conversations: [] as any[], updateCompactionState: jest.fn() }));
jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: { getState: () => mockChatStoreGetState() },
}));
jest.mock('../../../src/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ getProject: jest.fn(() => null) }) },
}));

type Engine = 'llama' | 'litert' | 'remote';

const baseImageModel = { id: 'img-1', name: 'SD Model' };

function modelForEngine(engine: Engine) {
  if (engine === 'remote') return createDownloadedModel({ id: 'remote-model', engine: 'llama' });
  // llama filePath must match llmService.getLoadedModelPath() so the readiness gate
  // sees the model as already resident (no on-demand load in the test env).
  return createDownloadedModel({ id: `${engine}-model`, engine, filePath: '/path/model.gguf' });
}

function makeDeps(engine: Engine, overrides: Record<string, unknown> = {}): any {
  const model = modelForEngine(engine);
  return {
    activeModelId: model.id,
    activeModel: engine === 'remote' ? null : model,
    activeModelInfo: { isRemote: engine === 'remote', model, modelId: model.id, modelName: model.name },
    hasActiveModel: true,
    activeConversationId: 'conv-1',
    activeConversation: { id: 'conv-1', messages: [] },
    activeProject: null,
    activeImageModel: null,
    imageModelLoaded: false,
    hasTextModel: true,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    settings: {
      showGenerationDetails: false,
      imageGenerationMode: 'auto',
      autoDetectMethod: 'simple',
      classifierModelId: null,
      systemPrompt: 'Be helpful',
      thinkingEnabled: false,
      imageSteps: 8,
      imageGuidanceScale: 2,
    },
    downloadedModels: [model],
    setAlertState: jest.fn(),
    setIsClassifying: jest.fn(),
    setAppImageGenerationStatus: jest.fn(),
    setAppIsGeneratingImage: jest.fn(),
    addMessage: jest.fn(),
    clearStreamingMessage: jest.fn(),
    deleteConversation: jest.fn(),
    setActiveConversation: jest.fn(),
    removeImagesByConversationId: jest.fn(() => []),
    navigation: { goBack: jest.fn(), navigate: jest.fn() },
    ensureModelLoaded: jest.fn(() => Promise.resolve({ ok: true })),
    ensureTextModelForChat: jest.fn(() => Promise.resolve(true)),
    createConversation: jest.fn(() => 'new-conv-id'),
    pendingProjectId: undefined,
    setDebugInfo: jest.fn(),
    setShowSettingsPanel: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useRemoteServerStore.setState({ activeServerId: null, activeRemoteTextModelId: null } as any);
  generationSession._reset();
  mockClassifyIntent.mockResolvedValue('text');
  mockGenerateResponse.mockResolvedValue(undefined);
  mockGenerateWithTools.mockResolvedValue(undefined);
  mockGenerateImage.mockResolvedValue({ id: 'gen-1', imagePath: '/out.png' });
  mockChatStoreGetState.mockReturnValue({ conversations: [], updateCompactionState: jest.fn() });
});

describe('chatMatrix — resend across engine × recorded turn kind', () => {
  describe.each<Engine>(['llama', 'litert', 'remote'])('engine=%s', (engine) => {
    if (engine === 'remote') {
      // Route the deps through the remote server store so the resend text path is the
      // remote one (activeRemoteTextModelId set). This is set per-test below.
    }

    it('resending an IMAGE turn RE-DRAWS the image (not text) — image gate TRUE branch', async () => {
      // An image turn: the user asked to draw; the recorded turn is an image. On resend
      // the classifier again says "image" and an image model is selected → it must redraw.
      mockClassifyIntent.mockResolvedValue('image');
      const deps = makeDeps(engine, { activeImageModel: baseImageModel });
      if (engine === 'remote') useRemoteServerStore.setState({ activeRemoteTextModelId: 'remote-text' } as any);

      const userMessage = createMessage({ role: 'user', content: 'draw a red fox in snow' });
      await regenerateResponseFn(deps, { setDebugInfo: deps.setDebugInfo, userMessage });

      // CONSEQUENCE: the image pipeline ran with the exact prompt into the same conversation...
      expect(mockGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'draw a red fox in snow', conversationId: 'conv-1' }),
      );
      // ...and text generation did NOT run (the image turn didn't fall back to text).
      expect(mockGenerateResponse).not.toHaveBeenCalled();
      expect(mockGenerateWithTools).not.toHaveBeenCalled();
    });

    it('resending a TEXT turn regenerates TEXT (not an image) — image gate FALSE branch', async () => {
      mockClassifyIntent.mockResolvedValue('text');
      // Even with an image model selected, a text-classified prompt must NOT redraw.
      const deps = makeDeps(engine, { activeImageModel: baseImageModel });
      if (engine === 'remote') useRemoteServerStore.setState({ activeRemoteTextModelId: 'remote-text' } as any);
      mockChatStoreGetState.mockReturnValue({
        conversations: [{ id: 'conv-1', messages: [createMessage({ role: 'user', content: 'explain quantum tunneling' })] }],
        updateCompactionState: jest.fn(),
      });

      const userMessage = createMessage({ role: 'user', content: 'explain quantum tunneling' });
      await regenerateResponseFn(deps, { setDebugInfo: deps.setDebugInfo, userMessage });

      // CONSEQUENCE: the image pipeline did NOT run...
      expect(mockGenerateImage).not.toHaveBeenCalled();
      // ...and a text generation path ran (either plain or tool loop, both are text).
      expect(mockGenerateResponse.mock.calls.length + mockGenerateWithTools.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it('litert resend rewinds native history before replaying (engine-specific invariant)', async () => {
    // LiteRT keeps native conversation history; a resend must invalidate it so the
    // replayed JS messages are not double-counted. This is the litert-only step in
    // regenerateResponseFn that the llama/remote paths never take.
    mockClassifyIntent.mockResolvedValue('text');
    const deps = makeDeps('litert');
    mockChatStoreGetState.mockReturnValue({
      conversations: [{ id: 'conv-1', messages: [createMessage({ role: 'user', content: 'hello again' })] }],
      updateCompactionState: jest.fn(),
    });

    const userMessage = createMessage({ role: 'user', content: 'hello again' });
    await regenerateResponseFn(deps, { setDebugInfo: deps.setDebugInfo, userMessage });

    expect(mockInvalidateConversation).toHaveBeenCalled();
  });

  it('llama resend does NOT rewind litert history (no cross-engine leakage)', async () => {
    mockClassifyIntent.mockResolvedValue('text');
    const deps = makeDeps('llama');
    mockChatStoreGetState.mockReturnValue({
      conversations: [{ id: 'conv-1', messages: [createMessage({ role: 'user', content: 'hi' })] }],
      updateCompactionState: jest.fn(),
    });

    const userMessage = createMessage({ role: 'user', content: 'hi' });
    await regenerateResponseFn(deps, { setDebugInfo: deps.setDebugInfo, userMessage });

    expect(mockInvalidateConversation).not.toHaveBeenCalled();
  });
});
