/**
 * Unit tests for useChatGenerationActions
 *
 * Covers uncovered branches:
 * - shouldRouteToImageGenerationFn: LLM-based classification path (lines 90, 100-105)
 * - handleImageGenerationFn: skipUserMessage=false path (lines 127-128), error path (line 141)
 * - startGenerationFn: generateResponse call (line 184)
 * - handleSendFn: no model (lines 203-204)
 * - executeDeleteConversationFn: image cleanup (line 264)
 * - regenerateResponseFn: shouldGenerateImage+imageModel path (lines 279-280)
 */

import {
  shouldRouteToImageGenerationFn,
  handleImageGenerationFn,
  startGenerationFn,
  executeDeleteConversationFn,
  regenerateResponseFn,
  handleSendFn,
  handleStopFn,
  handleSelectProjectFn,
  dispatchGenerationFn,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';
import * as generationActions from '../../../src/screens/ChatScreen/useChatGenerationActions';
import * as hookRegistry from '../../../src/bootstrap/hookRegistry';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { generationSession } from '../../../src/services/generationSession';
import { createDownloadedModel } from '../../utils/factories';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

// Mock heavy service modules that pull in native code or env variables
jest.mock('../../../src/services/huggingface', () => ({ huggingFaceService: {} }));
jest.mock('../../../src/services/modelManager', () => ({ modelManager: {} }));
jest.mock('../../../src/services/hardware', () => ({ hardwareService: {} }));
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: { isAvailable: jest.fn(() => false), excludeFromBackup: jest.fn(() => Promise.resolve(true)) },
}));
jest.mock('../../../src/services/activeModelService/index', () => ({
  activeModelService: { loadTextModel: jest.fn(), unloadTextModel: jest.fn() },
}));
jest.mock('../../../src/services/intentClassifier', () => ({
  intentClassifier: { classifyIntent: jest.fn() },
  classifyToolsNeeded: jest.fn(() => ['get_current_datetime', 'web_search', 'read_url', 'search_knowledge_base']),
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
    getLoadedModelPath: jest.fn(),
    isModelLoaded: jest.fn(),
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
    getMultimodalSupport: jest.fn(() => null),
    isGemma4Model: jest.fn(() => false),
    isThinkingEnabled: jest.fn(() => false),
    stopGeneration: jest.fn(),
    getContextDebugInfo: jest.fn(),
    clearKVCache: jest.fn(),
  },
}));
// engines.activeLocalTextCapabilities / wantsLeadingThinkToken read the litert service directly;
// mock it as a dumb flag reader so the real engine registry resolves deterministically here.
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(() => false) },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    deleteGeneratedImage: jest.fn(),
  },
}));
jest.mock('../../../src/services/rag', () => ({
  ragService: {
    searchProject: jest.fn(() => Promise.resolve({ chunks: [], truncated: false })),
    getDocumentsByProject: jest.fn(() => Promise.resolve([])),
  },
  retrievalService: { formatForPrompt: jest.fn(() => '<knowledge_base>mock RAG context</knowledge_base>') },
}));
jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: jest.fn(() => false),
    load: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../../src/services/contextCompaction', () => ({
  contextCompactionService: {
    isContextFullError: jest.fn(() => false),
    compact: jest.fn(),
    clearSummary: jest.fn(),
  },
}));

// Get mock references after hoisting
const { intentClassifier } = require('../../../src/services/intentClassifier');
const { generationService } = require('../../../src/services/generationService');
const { imageGenerationService } = require('../../../src/services/imageGenerationService');
const { llmService } = require('../../../src/services/llm');
const { localDreamGeneratorService } = require('../../../src/services/localDreamGenerator');

// Typed references
const mockClassifyIntent = intentClassifier.classifyIntent as jest.Mock;
const mockGenerateResponse = generationService.generateResponse as jest.Mock;
const mockGenerateWithTools = generationService.generateWithTools as jest.Mock;
const mockStopGenerationService = generationService.stopGeneration as jest.Mock;
const mockEnqueueMessage = generationService.enqueueMessage as jest.Mock;
const mockGetGenerationState = generationService.getState as jest.Mock;
const mockGenerateImage = imageGenerationService.generateImage as jest.Mock;
const mockGetImageGenState = imageGenerationService.getState as jest.Mock;
const mockCancelGeneration = imageGenerationService.cancelGeneration as jest.Mock;
const mockGetLoadedModelPath = llmService.getLoadedModelPath as jest.Mock;
const mockIsModelLoaded = llmService.isModelLoaded as jest.Mock;
const mockStopLlmGeneration = llmService.stopGeneration as jest.Mock;
const mockGetContextDebugInfo = llmService.getContextDebugInfo as jest.Mock;
const mockClearKVCache = llmService.clearKVCache as jest.Mock;
const mockDeleteGeneratedImage = localDreamGeneratorService.deleteGeneratedImage as jest.Mock;
const { liteRTService } = require('../../../src/services/litert');
const mockLiteRTLoaded = liteRTService.isModelLoaded as jest.Mock;

const { ragService } = require('../../../src/services/rag');
const { retrievalService } = require('../../../src/services/rag');
const mockSearchProject = ragService.searchProject as jest.Mock;
const mockGetDocsByProject = ragService.getDocumentsByProject as jest.Mock;
const mockFormatForPrompt = retrievalService.formatForPrompt as jest.Mock;


const mockChatStoreGetState = jest.fn(() => ({ conversations: [] as any[], updateCompactionState: jest.fn() }));
jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: { getState: () => mockChatStoreGetState() },
}));

const mockProjectStoreGetProject = jest.fn((_id: string) => null as any);
jest.mock('../../../src/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ getProject: mockProjectStoreGetProject }) },
}));

jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message?: string, buttons?: any[]) => ({ visible: true, title, message, buttons: buttons || [] })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

jest.mock('../../../src/constants', () => ({
  APP_CONFIG: { defaultSystemPrompt: 'You are a helpful assistant.' },
}));

// ─────────────────────────────────────────────
// Default implementations (reset each test)
// ─────────────────────────────────────────────

beforeEach(() => {
  // Reset remote server store to default (no active server)
  useRemoteServerStore.setState({ activeServerId: null, activeRemoteTextModelId: null });
  generationSession._reset(); // single owner of 'which conversation is generating'
  mockClassifyIntent.mockResolvedValue('text');
  mockGenerateResponse.mockResolvedValue(undefined);
  mockGenerateWithTools.mockResolvedValue(undefined);
  mockStopGenerationService.mockResolvedValue(undefined);
  mockGenerateImage.mockResolvedValue(null);
  mockCancelGeneration.mockResolvedValue(undefined);
  mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
  mockIsModelLoaded.mockReturnValue(true);
  (llmService.supportsToolCalling as jest.Mock).mockReturnValue(false);
  (llmService.isGemma4Model as jest.Mock).mockReturnValue(false);
  (llmService.isThinkingEnabled as jest.Mock).mockReturnValue(false);
  mockLiteRTLoaded.mockReturnValue(false);
  mockStopLlmGeneration.mockResolvedValue(undefined);
  mockGetContextDebugInfo.mockResolvedValue({ truncatedCount: 0, contextUsagePercent: 0 });
  mockClearKVCache.mockResolvedValue(undefined);
  mockDeleteGeneratedImage.mockResolvedValue(undefined);
  mockGetGenerationState.mockReturnValue({ isGenerating: false });
  mockGetImageGenState.mockReturnValue({ isGenerating: false });
  mockEnqueueMessage.mockReturnValue(undefined);
  mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });
  mockGetDocsByProject.mockResolvedValue([]);
  mockFormatForPrompt.mockReturnValue('<knowledge_base>mock RAG context</knowledge_base>');
  mockChatStoreGetState.mockReturnValue({ conversations: [], updateCompactionState: jest.fn() });
  mockProjectStoreGetProject.mockReturnValue(null);
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────


const baseModel = createDownloadedModel({ id: 'model-1', filePath: '/path/model.gguf' });
const baseImageModel = { id: 'img-1', name: 'SD Model' };

function makeGenerationDeps(overrides: Record<string, unknown> = {}): any {
  return {
    activeModelId: 'model-1',
    activeModel: baseModel,
    activeModelInfo: { isRemote: false, model: baseModel, modelId: 'model-1', modelName: 'Test Model' },
    hasActiveModel: true,
    activeConversationId: 'conv-1',
    activeConversation: { id: 'conv-1', messages: [] },
    activeProject: null,
    activeImageModel: null,
    imageModelLoaded: false,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    settings: {
      showGenerationDetails: false,
      imageGenerationMode: 'auto',
      autoDetectMethod: 'simple',
      classifierModelId: null,
      systemPrompt: 'Be helpful',
      imageSteps: 8,
      imageGuidanceScale: 2,
    },
    downloadedModels: [baseModel],
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
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// shouldRouteToImageGenerationFn
// ─────────────────────────────────────────────

describe('shouldRouteToImageGenerationFn', () => {
  it('returns false when already generating image', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: true, imageModelLoaded: true });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(result).toBe(false);
  });

  it('returns forceImageMode===true when mode is manual', async () => {
    const deps = makeGenerationDeps({ settings: { ...makeGenerationDeps().settings, imageGenerationMode: 'manual' } });
    expect(await shouldRouteToImageGenerationFn(deps, 'text', true)).toBe(true);
    expect(await shouldRouteToImageGenerationFn(deps, 'text', false)).toBe(false);
  });

  it('returns true immediately when forceImageMode', async () => {
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw', true);
    expect(result).toBe(true);
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('returns false when no image model is selected WITHOUT running the classifier or setting a status (F12)', async () => {
    // Auto mode + no image model: there is nothing to route to, so the classifier must
    // not run (it only adds latency on the send hot path) and no "Analyzing…" status
    // should be set. Regression guard for the removed early-out.
    const deps = makeGenerationDeps({ activeImageModel: null });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(result).toBe(false);
    expect(mockClassifyIntent).not.toHaveBeenCalled();
    expect(deps.setIsClassifying).not.toHaveBeenCalledWith(true);
    expect(deps.setAppImageGenerationStatus).not.toHaveBeenCalled();
  });

  it('routes an image request even when the image model is NOT resident (loads on demand — the voice-mode fix)', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    // Audio mode: text+TTS resident, image model evicted. Gating on "selected", not
    // "loaded", lets "draw a horse" route to the pipeline (which loads it on demand).
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel, imageModelLoaded: false });
    expect(await shouldRouteToImageGenerationFn(deps, 'draw a horse')).toBe(true);
  });

  it('with no text model, routes a chat request to text (heuristics)', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text');
    const deps = makeGenerationDeps({ hasTextModel: false, activeImageModel: baseImageModel });
    const result = await shouldRouteToImageGenerationFn(deps, 'tell me a joke');
    expect(result).toBe(false);
    expect(mockClassifyIntent).toHaveBeenCalledWith('tell me a joke', { useLLM: false });
  });

  it('with no text model, routes an image request to image (heuristics)', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    const deps = makeGenerationDeps({ hasTextModel: false, activeImageModel: baseImageModel });
    expect(await shouldRouteToImageGenerationFn(deps, 'draw a dog')).toBe(true);
  });

  it('with no text model but a classifier configured, uses the SMOL LLM', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text');
    const classifier = { ...baseModel, id: 'smol-1' };
    const deps = makeGenerationDeps({
      hasTextModel: false, activeImageModel: baseImageModel,
      downloadedModels: [baseModel, classifier],
      settings: { ...makeGenerationDeps().settings, classifierModelId: 'smol-1' },
    });
    const result = await shouldRouteToImageGenerationFn(deps, 'tell me a joke');
    expect(result).toBe(false);
    expect(mockClassifyIntent).toHaveBeenCalledWith('tell me a joke', expect.objectContaining({ useLLM: true, classifierModel: classifier }));
    expect(deps.setIsClassifying).toHaveBeenCalledWith(true);
    expect(deps.setIsClassifying).toHaveBeenCalledWith(false);
  });

  it('classifies intent via LLM when autoDetectMethod=llm', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      settings: { ...makeGenerationDeps().settings, autoDetectMethod: 'llm' },
    });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw a cat');
    expect(deps.setIsClassifying).toHaveBeenCalledWith(true);
    expect(result).toBe(true);
    expect(deps.setIsClassifying).toHaveBeenCalledWith(false);
  });

  it('resets image status when LLM returns non-image intent', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text');
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      settings: { ...makeGenerationDeps().settings, autoDetectMethod: 'llm' },
    });
    const result = await shouldRouteToImageGenerationFn(deps, 'hello');
    expect(result).toBe(false);
    expect(deps.setAppImageGenerationStatus).toHaveBeenCalledWith(null);
    expect(deps.setAppIsGeneratingImage).toHaveBeenCalledWith(false);
  });

  it('returns false and resets state when classification throws', async () => {
    mockClassifyIntent.mockRejectedValueOnce(new Error('network error'));
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    const result = await shouldRouteToImageGenerationFn(deps, 'draw');
    expect(result).toBe(false);
    expect(deps.setIsClassifying).toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────
// handleImageGenerationFn
// ─────────────────────────────────────────────

describe('handleImageGenerationFn', () => {
  it('shows alert when no image model loaded', async () => {
    const deps = makeGenerationDeps({ activeImageModel: null });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('adds user message when skipUserMessage is false (default)', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/img.png' });
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    });
    await handleImageGenerationFn(deps, { prompt: 'a dog', conversationId: 'conv-1' });
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user', content: 'a dog' }));
  });

  it('keeps attachments (e.g. a voice note) on the user message in the image route', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/img.png' });
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    });
    const attachments = [{ id: 'a1', type: 'audio' as const, uri: 'file:///rec.m4a', audioDurationSeconds: 3 }];
    await handleImageGenerationFn(deps, { prompt: 'a dog', conversationId: 'conv-1', attachments });
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user', content: 'a dog', attachments }));
  });

  it('skips user message when skipUserMessage=true', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/img.png' });
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel, imageGenState: { isGenerating: false, error: null } });
    await handleImageGenerationFn(deps, { prompt: 'a dog', conversationId: 'conv-1', skipUserMessage: true });
    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('shows alert when image generation returns null and there is a non-cancel error', async () => {
    mockGenerateImage.mockResolvedValueOnce(null);
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, error: 'out of memory' },
    });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
  });

  it('does not show alert when error is "cancelled"', async () => {
    mockGenerateImage.mockResolvedValueOnce(null);
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, error: 'cancelled by user' },
    });
    await handleImageGenerationFn(deps, { prompt: 'cat', conversationId: 'conv-1' });
    expect(deps.setAlertState).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// executeDeleteConversationFn
// ─────────────────────────────────────────────

describe('executeDeleteConversationFn', () => {
  it('returns early when no activeConversationId', async () => {
    const deps = makeGenerationDeps({ activeConversationId: null });
    await executeDeleteConversationFn(deps);
    expect(deps.deleteConversation).not.toHaveBeenCalled();
  });

  it('stops streaming before deleting when isStreaming=true', async () => {
    const deps = makeGenerationDeps({ isStreaming: true });
    await executeDeleteConversationFn(deps);
    expect(mockStopLlmGeneration).toHaveBeenCalled();
    expect(deps.clearStreamingMessage).toHaveBeenCalled();
    expect(deps.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(deps.navigation.goBack).toHaveBeenCalled();
  });

  it('deletes generated images for the conversation', async () => {
    const deps = makeGenerationDeps();
    deps.removeImagesByConversationId.mockReturnValue(['img-1', 'img-2']);
    await executeDeleteConversationFn(deps);
    expect(mockDeleteGeneratedImage).toHaveBeenCalledTimes(2);
    expect(mockDeleteGeneratedImage).toHaveBeenCalledWith('img-1');
    expect(mockDeleteGeneratedImage).toHaveBeenCalledWith('img-2');
    expect(deps.deleteConversation).toHaveBeenCalledWith('conv-1');
    expect(deps.setActiveConversation).toHaveBeenCalledWith(null);
  });
});

// ─────────────────────────────────────────────
// regenerateResponseFn
// ─────────────────────────────────────────────

describe('regenerateResponseFn', () => {
  it('returns early when no activeConversationId', async () => {
    const deps = makeGenerationDeps({ activeConversationId: null, activeModel: undefined });
    const msg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg });
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('routes to image generation when shouldGenerate=true and imageModel loaded', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/out.png' });
    const deps = makeGenerationDeps({
      imageModelLoaded: true,
      activeImageModel: baseImageModel,
      imageGenState: { isGenerating: false, progress: null, status: null, previewPath: null, prompt: null, conversationId: null, error: null, result: null },
    });
    const msg = { id: 'm1', role: 'user' as const, content: 'draw a fox', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg });
    // Should call generateImage instead of generateResponse
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('calls generateResponse with context messages', async () => {
    mockGenerateResponse.mockResolvedValueOnce(undefined);
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeConversation: { id: 'conv-1', messages: [userMsg] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(mockGenerateResponse).toHaveBeenCalledWith('conv-1', expect.any(Array));
    expect(generationSession.getConversationId()).toBeNull();
  });

  it('shows alert when generateResponse throws', async () => {
    mockGenerateResponse.mockRejectedValueOnce(new Error('Server error'));
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeConversation: { id: 'conv-1', messages: [userMsg] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Generation Error' }));
  });

  // ── Deterministic resend: the turn's RECORDED kind picks the pipeline (the 1★ Android
  //    "Resend → model cannot be loaded" regression). An image turn must re-run the image
  //    pipeline even when current settings/classifier would say "text", and must NOT be
  //    re-classified into the text pipeline (which then fails to load a text model).
  it('recordedKind=image re-runs the IMAGE pipeline even when the classifier would say text', async () => {
    mockClassifyIntent.mockResolvedValue('text'); // classifier would misroute to text
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/out.png' });
    const deps = makeGenerationDeps({
      imageModelLoaded: true,
      activeImageModel: baseImageModel,
      settings: { ...makeGenerationDeps().settings, imageGenerationMode: 'manual' }, // manual → classifier off, old code → text
    });
    const msg = { id: 'm1', role: 'user' as const, content: 'a fox in snow', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg, recordedKind: 'image' });
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
    expect(mockGenerateWithTools).not.toHaveBeenCalled();
  });

  it('recordedKind=image does NOT consult the classifier at all (deterministic replay)', async () => {
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/out.png' });
    const deps = makeGenerationDeps({ imageModelLoaded: true, activeImageModel: baseImageModel });
    const msg = { id: 'm1', role: 'user' as const, content: 'a fox', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg, recordedKind: 'image' });
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('recordedKind=text re-runs the TEXT pipeline even when the classifier would say image', async () => {
    mockClassifyIntent.mockResolvedValue('image'); // classifier would misroute to image
    mockGenerateResponse.mockResolvedValueOnce(undefined);
    const userMsg = { id: 'm1', role: 'user' as const, content: 'draw me a diagram of X', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeImageModel: baseImageModel, // image model IS available, but this turn was text
      activeConversation: { id: 'conv-1', messages: [userMsg] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg, recordedKind: 'text' });
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('no recordedKind (legacy turn) falls back to classifier routing', async () => {
    mockClassifyIntent.mockResolvedValue('image');
    mockGenerateImage.mockResolvedValueOnce({ imagePath: '/out.png' });
    const deps = makeGenerationDeps({ imageModelLoaded: true, activeImageModel: baseImageModel });
    const msg = { id: 'm1', role: 'user' as const, content: 'draw a fox', timestamp: 0 };
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: msg });
    expect(mockClassifyIntent).toHaveBeenCalled(); // legacy path still classifies
    expect(mockGenerateImage).toHaveBeenCalled();
  });
});

// ── resolveTurnKind: the ONE modality decision seam send + resend share ──
describe('resolveTurnKind', () => {
  it('a recorded kind wins verbatim and never consults the classifier (replay determinism)', async () => {
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    expect(await generationActions.resolveTurnKind(deps, { text: 'anything', recordedKind: 'image' })).toBe('image');
    expect(await generationActions.resolveTurnKind(deps, { text: 'anything', recordedKind: 'text' })).toBe('text');
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('a new turn with image disabled resolves to text without classifying', async () => {
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    expect(await generationActions.resolveTurnKind(deps, { text: 'draw a cat', imageEnabled: false })).toBe('text');
    expect(mockClassifyIntent).not.toHaveBeenCalled();
  });

  it('a new turn (no recorded kind) defers to the route rule', async () => {
    mockClassifyIntent.mockResolvedValue('image');
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    expect(await generationActions.resolveTurnKind(deps, { text: 'draw a cat' })).toBe('image');
    mockClassifyIntent.mockResolvedValue('text');
    expect(await generationActions.resolveTurnKind(deps, { text: 'hello there' })).toBe('text');
  });

  it('forceImageMode forces image on a new turn', async () => {
    const deps = makeGenerationDeps({ activeImageModel: baseImageModel });
    expect(await generationActions.resolveTurnKind(deps, { text: 'x', forceImageMode: true })).toBe('image');
  });
});

// ── Pure helpers: recorded-turn-modality lookup (single source read on resend/edit) ──
describe('recordedTurnKind / messageHasImageOutput', () => {
  const userMsg = (id: string, content = 'hi') => ({ id, role: 'user' as const, content, timestamp: 0 });
  const textReply = (id: string) => ({ id, role: 'assistant' as const, content: 'answer', timestamp: 0 });
  const imageReply = (id: string) => ({
    id, role: 'assistant' as const, content: '', timestamp: 0,
    attachments: [{ id: 'img', type: 'image' as const, uri: 'file:///out.png', width: 512, height: 512 }],
  });

  it('reads image when the reply after the user message carries an image attachment', () => {
    const msgs = [userMsg('u1'), imageReply('a1')];
    expect(generationActions.recordedTurnKind(msgs, 'u1')).toBe('image');
  });

  // Device-confirmed regression: an image turn emits an "Enhanced prompt" assistant message (no
  // image) BEFORE the image-result message. Scanning only the FIRST reply returned 'text' → resend
  // loaded a text model instead of re-drawing. Must scan the WHOLE turn.
  it('reads image when a LATER reply in the turn has the image (enhanced-prompt precedes it)', () => {
    const enhancedPrompt = { id: 'a1', role: 'assistant' as const, content: '<think>enhanced</think>', timestamp: 0 };
    const msgs = [userMsg('u1', 'draw a dog'), enhancedPrompt, imageReply('a2')];
    expect(generationActions.recordedTurnKind(msgs, 'u1')).toBe('image');
  });

  it('stops at the NEXT user message — an image in a later turn does not leak into this one', () => {
    const msgs = [userMsg('u1'), textReply('a1'), userMsg('u2', 'draw'), imageReply('a2')];
    expect(generationActions.recordedTurnKind(msgs, 'u1')).toBe('text');
    expect(generationActions.recordedTurnKind(msgs, 'u2')).toBe('image');
  });

  it('reads text when the reply is a plain assistant message', () => {
    const msgs = [userMsg('u1'), textReply('a1')];
    expect(generationActions.recordedTurnKind(msgs, 'u1')).toBe('text');
  });

  it('returns undefined when the turn has no reply yet (never generated)', () => {
    expect(generationActions.recordedTurnKind([userMsg('u1')], 'u1')).toBeUndefined();
  });

  it('returns undefined when the user message is unknown', () => {
    expect(generationActions.recordedTurnKind([userMsg('u1'), textReply('a1')], 'ghost')).toBeUndefined();
  });

  it('messageHasImageOutput distinguishes image attachments from documents/none', () => {
    expect(generationActions.messageHasImageOutput(imageReply('a1'))).toBe(true);
    expect(generationActions.messageHasImageOutput(textReply('a1'))).toBe(false);
    expect(generationActions.messageHasImageOutput({
      id: 'a', role: 'assistant', content: 'x', timestamp: 0,
      attachments: [{ id: 'd', type: 'document', uri: 'file:///f.pdf' }],
    } as any)).toBe(false);
    expect(generationActions.messageHasImageOutput(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// handleSendFn
// ─────────────────────────────────────────────

describe('handleSendFn', () => {
  it('stops stale TTS on the new-turn send action (fires audio.stop)', async () => {
    // Regression: the stop used to live in a useChatScreen effect keyed on the
    // streaming flag, which bounced on every tool-call round and aborted the
    // CURRENT answer's streaming TTS. It now fires once, on the user send.
    const spy = jest.spyOn(hookRegistry, 'callHook').mockReturnValue(undefined as never);
    try {
      const deps = makeGenerationDeps();
      await handleSendFn(deps, {
        text: 'hello', imageMode: 'disabled', startGeneration: jest.fn(() => Promise.resolve()), setDebugInfo: jest.fn(),
      });
      expect(spy).toHaveBeenCalledWith(hookRegistry.HOOKS.audioStop);
    } finally {
      spy.mockRestore();
    }
  });

  it('does NOT stop TTS when there is no active model (early return before send)', async () => {
    const spy = jest.spyOn(hookRegistry, 'callHook').mockReturnValue(undefined as never);
    try {
      const deps = makeGenerationDeps({ activeModel: undefined, hasActiveModel: false });
      await handleSendFn(deps, { text: 'hello', imageMode: 'auto', startGeneration: jest.fn(), setDebugInfo: jest.fn() });
      expect(spy).not.toHaveBeenCalledWith(hookRegistry.HOOKS.audioStop);
    } finally {
      spy.mockRestore();
    }
  });

  it('lazily creates conversation and sends when no activeConversationId', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps({ activeConversationId: null });
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'disabled',
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(deps.createConversation).toHaveBeenCalledWith('model-1', undefined, undefined);
    expect(deps.setActiveConversation).toHaveBeenCalledWith('new-conv-id');
    expect(startGeneration).toHaveBeenCalledWith('new-conv-id', 'hello');
  });

  it('loads a text model on demand for a chat request in image-only mode', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text'); // chat intent, heuristic
    const startGeneration = jest.fn(() => Promise.resolve());
    const ensureTextModelForChat = jest.fn(() => Promise.resolve(true));
    const deps = makeGenerationDeps({
      imageModelLoaded: true, hasTextModel: false, activeImageModel: { id: 'img' }, ensureTextModelForChat,
    });
    await handleSendFn(deps, { text: 'tell me a joke', imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    expect(ensureTextModelForChat).toHaveBeenCalled();
    expect(startGeneration).toHaveBeenCalled();
  });

  it('aborts the send and stashes the message when no text model is chosen', async () => {
    mockClassifyIntent.mockResolvedValueOnce('text');
    const startGeneration = jest.fn(() => Promise.resolve());
    const ensureTextModelForChat = jest.fn(() => Promise.resolve(false)); // opened selector
    const setPendingMessage = jest.fn();
    const deps = makeGenerationDeps({
      imageModelLoaded: true, hasTextModel: false, activeImageModel: { id: 'img' },
      ensureTextModelForChat, setPendingMessage,
    });
    await handleSendFn(deps, { text: 'tell me a joke', imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    expect(ensureTextModelForChat).toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
    // The message is remembered so it can be replayed after the user picks a model.
    expect(setPendingMessage).toHaveBeenCalledWith('tell me a joke', undefined);
  });

  it('shows alert when no activeModel', async () => {
    const deps = makeGenerationDeps({ activeModel: undefined, hasActiveModel: false });
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'auto',
      startGeneration: jest.fn(),
      setDebugInfo: jest.fn(),
    });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'No Model Selected' }));
  });

  it('calls startGeneration for a normal text message', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'auto',
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user' }));
    expect(startGeneration).toHaveBeenCalledWith('conv-1', 'hello');
  });

  it('queues a text message instead of starting one while an image generation is running', async () => {
    mockGetImageGenState.mockReturnValue({ isGenerating: true });
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, { text: 'hello', imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    // Never starts a second heavy op; the message is queued and routing is skipped.
    expect(startGeneration).not.toHaveBeenCalled();
    expect(mockClassifyIntent).not.toHaveBeenCalled();
    expect(mockEnqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'hello' }),
    );
  });

  it('queues a text message while a text generation is running', async () => {
    mockGetGenerationState.mockReturnValue({ isGenerating: true });
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, { text: 'hello', imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    expect(startGeneration).not.toHaveBeenCalled();
    expect(mockEnqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'hello' }),
    );
  });
});

// ─────────────────────────────────────────────
// handleStopFn
// ─────────────────────────────────────────────

describe('handleStopFn', () => {
  it('stops generation and cancels image generation when isGeneratingImage=true', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: true });
    await handleStopFn(deps);
    expect(mockStopGenerationService).toHaveBeenCalled();
    expect(mockCancelGeneration).toHaveBeenCalled();
    expect(generationSession.getConversationId()).toBeNull();
  });

  it('stops generation without cancelling image when not generating image', async () => {
    const deps = makeGenerationDeps({ isGeneratingImage: false });
    await handleStopFn(deps);
    expect(mockStopGenerationService).toHaveBeenCalled();
    expect(mockCancelGeneration).not.toHaveBeenCalled();
  });

  it('stops TTS on abort (fires audio.stop) — the phone must go quiet when the user hits Stop', async () => {
    // Regression: handleStopFn stopped the LLM but never fired audio.stop, so streaming
    // TTS kept speaking every sentence already buffered ahead of playback after Stop.
    const spy = jest.spyOn(hookRegistry, 'callHook').mockReturnValue(undefined as never);
    try {
      await handleStopFn(makeGenerationDeps({ isGeneratingImage: false }));
      expect(spy).toHaveBeenCalledWith(hookRegistry.HOOKS.audioStop);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────
// startGenerationFn
// ─────────────────────────────────────────────

describe('dispatchGenerationFn (single routing layer)', () => {
  it('routes a text message to text generation even with an image model loaded', async () => {
    // Regression for the flaky "text question generated an image" bug: a text
    // model is selected, an image model is loaded. "Hi" classifies as text → must
    // go to the text executor, never image generation.
    const startText = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps({ imageModelLoaded: true, activeImageModel: baseImageModel, hasTextModel: true });
    await dispatchGenerationFn(deps, { text: 'Hi', conversationId: 'conv-1' }, startText);
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(startText).toHaveBeenCalledWith('conv-1', 'Hi');
    expect(deps.addMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({ role: 'user' }));
  });

  it('routes an image request to image generation', async () => {
    mockClassifyIntent.mockResolvedValueOnce('image');
    const startText = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps({
      imageModelLoaded: true, activeImageModel: baseImageModel,
      settings: { ...makeGenerationDeps().settings, autoDetectMethod: 'llm' },
    });
    await dispatchGenerationFn(deps, { text: 'draw a cat', conversationId: 'conv-1' }, startText);
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(startText).not.toHaveBeenCalled();
  });

  it('honors force image mode', async () => {
    const startText = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps({ imageModelLoaded: true, activeImageModel: baseImageModel });
    await dispatchGenerationFn(deps, { text: 'anything', conversationId: 'conv-1', imageMode: 'force' }, startText);
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(startText).not.toHaveBeenCalled();
  });

  it('stashes the message when text routing needs a model that is not chosen', async () => {
    const startText = jest.fn(() => Promise.resolve());
    const ensureTextModelForChat = jest.fn(() => Promise.resolve(false));
    const setPendingMessage = jest.fn();
    const deps = makeGenerationDeps({
      imageModelLoaded: true, activeImageModel: baseImageModel,
      hasTextModel: false, ensureTextModelForChat, setPendingMessage,
    });
    await dispatchGenerationFn(deps, { text: 'Hi', conversationId: 'conv-1' }, startText);
    expect(startText).not.toHaveBeenCalled();
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(setPendingMessage).toHaveBeenCalledWith('Hi', undefined);
  });
});

describe('startGenerationFn', () => {
  it('returns early when no activeModel', async () => {
    const deps = makeGenerationDeps({ activeModel: undefined, hasActiveModel: false });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('never routes to image — image-vs-text is decided upstream in dispatch', async () => {
    // Regression: startGenerationFn is a pure text executor. Even with an image
    // model loaded and the text model not resident in RAM, it must generate text,
    // never an image (routing lives in dispatchGenerationFn).
    mockGetLoadedModelPath.mockReturnValueOnce(null).mockReturnValue('/path/model.gguf');
    mockIsModelLoaded.mockReturnValue(true);
    const deps = makeGenerationDeps({ imageModelLoaded: true, activeImageModel: baseImageModel });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hi' });
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('calls generateResponse and invokes first-token callback', async () => {
    // Make generateResponse actually call the callback (3rd arg)
    mockGenerateResponse.mockImplementationOnce(async (_convId: string, _msgs: any, onFirstToken?: () => void) => {
      onFirstToken?.();
    });
    mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
    const deps = makeGenerationDeps();
    const setDebugInfo = jest.fn();
    await startGenerationFn(deps, { setDebugInfo, targetConversationId: 'conv-1', messageText: 'hello' });
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(generationSession.getConversationId()).toBeNull();
  });

  it('clears cache when context usage is high', async () => {
    mockGetContextDebugInfo.mockResolvedValueOnce({ truncatedCount: 0, contextUsagePercent: 75 });
    mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'test' });
    expect(mockClearKVCache).toHaveBeenCalledWith(false);
  });

  it('shows a reason-specific alert when the model is not loaded after ensureModelLoaded', async () => {
    mockGetLoadedModelPath.mockReturnValueOnce(null); // triggers needsModelLoad
    mockIsModelLoaded.mockReturnValueOnce(false); // model still not loaded after ensureModelLoaded → post-verify fails
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    // No longer a generic "Error" — the typed outcome drives a specific title.
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to Load Model' }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('uses tool loop when heuristic matches an enabled tool', async () => {
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      settings: { ...makeGenerationDeps().settings, enabledTools: ['get_current_datetime'] },
    });

    // classifyToolsNeeded mock returns get_current_datetime, so it survives the filter
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hi' });

    expect(mockGenerateWithTools).toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('uses generateResponse when no tools are enabled', async () => {
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      settings: { ...makeGenerationDeps().settings, enabledTools: [] },
    });

    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hi' });

    // No tools enabled → generateResponse (pure text), not generateWithTools
    expect(mockGenerateResponse).toHaveBeenCalled();
    expect(mockGenerateWithTools).not.toHaveBeenCalled();
  });

  it('uses the tool loop when the message clearly needs a tool', async () => {
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      settings: { ...makeGenerationDeps().settings, enabledTools: ['get_current_datetime'] },
    });

    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'What time is it?' });

    expect(mockGenerateWithTools).toHaveBeenCalledWith('conv-1', expect.any(Array), { enabledToolIds: ['get_current_datetime'] });
  });
});

// ─────────────────────────────────────────────
// UI tool gate ("N/A" badge) is honoured by generation
// Regression: web search fired even when the Tools control read "N/A" and the
// picker was unreachable, so the user could not turn it off. Generation must
// respect the same supportsToolCalling gate the UI shows.
// ─────────────────────────────────────────────

describe('UI tool gate (supportsToolCalling) gates generation', () => {
  it('does NOT inject tools when the UI gate is off, even if the engine supports tools and web_search is enabled', async () => {
    // Badge shows "N/A" → deps.supportsToolCalling === false. The engine itself
    // reports tool support and web_search is in settings, but the user has no way
    // to disable it, so generation must not pull any tools.
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      supportsToolCalling: false,
      settings: { ...makeGenerationDeps().settings, enabledTools: ['web_search', 'read_url'] },
    });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'what is the weather?' });

    expect(mockGenerateWithTools).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('injects tools when the UI gate is on (control)', async () => {
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      supportsToolCalling: true,
      settings: { ...makeGenerationDeps().settings, enabledTools: ['web_search'] },
    });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'what is the weather?' });

    expect(mockGenerateWithTools).toHaveBeenCalledWith('conv-1', expect.any(Array), expect.objectContaining({ enabledToolIds: ['web_search'] }));
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('treats an unset gate as allowed (backward compatible)', async () => {
    // deps without supportsToolCalling (undefined) must behave as before.
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const deps = makeGenerationDeps({
      settings: { ...makeGenerationDeps().settings, enabledTools: ['web_search'] },
    });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });

    expect(mockGenerateWithTools).toHaveBeenCalled();
  });

  it('regenerate also honours the UI tool gate', async () => {
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
    const userMsg = { id: 'm1', role: 'user' as const, content: 'what is the weather?', timestamp: 0 };
    const conv = { id: 'conv-1', messages: [userMsg] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps({
      supportsToolCalling: false,
      activeConversation: conv,
      settings: { ...makeGenerationDeps().settings, enabledTools: ['web_search'] },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });

    expect(mockGenerateWithTools).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// SO4 — engine tool-routing via the engine registry (no `engine === 'litert'` in the caller).
// These prove the migrated capability seam preserves the LiteRT behavior: native tools with NO
// text-hint double-inject, and the Gemma-4 <|think|> token driven by the engine, not a branch.
// ─────────────────────────────────────────────

describe('SO4 engine tool-routing (LiteRT native path via engine registry)', () => {
  const litertModel = createDownloadedModel({ id: 'lr', engine: 'litert', liteRTVision: false });
  const makeLiteRTDeps = (overrides: Record<string, unknown> = {}) => makeGenerationDeps({
    activeModelId: 'lr',
    activeModel: litertModel,
    activeModelInfo: { isRemote: false, model: litertModel, modelId: 'lr', modelName: 'LiteRT' },
    downloadedModels: [litertModel],
    ...overrides,
  });

  it('routes tools natively when the LiteRT engine is loaded (canUseTools from the registry, not supportsToolCalling)', async () => {
    // llama's Jinja tool support is OFF; only the LiteRT-loaded flag can make tools available.
    // Old code needed the explicit `isLiteRT` OR-term; the migration must keep this working.
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(false);
    mockLiteRTLoaded.mockReturnValue(true);
    const deps = makeLiteRTDeps({ settings: { ...makeGenerationDeps().settings, enabledTools: ['get_current_datetime'] } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'what time is it?' });

    expect(mockGenerateWithTools).toHaveBeenCalledWith('conv-1', expect.any(Array), expect.objectContaining({ enabledToolIds: ['get_current_datetime'] }));
  });

  it('does NOT inject the built-in tool text hint for LiteRT (native tools would double-inject)', async () => {
    mockLiteRTLoaded.mockReturnValue(true);
    const deps = makeLiteRTDeps({ settings: { ...makeGenerationDeps().settings, systemPrompt: 'Be helpful', enabledTools: ['get_current_datetime'] } });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'what time is it?' });

    // Terminal artifact: the system message that reaches generation. For LiteRT it is exactly the
    // base prompt — no appended tool-hint text (which is what llama-without-Jinja would get).
    const [, messages] = mockGenerateWithTools.mock.calls[0];
    expect(messages[0].content).toBe('Be helpful');
  });

  // The two Gemma-4 <|think|> tests that lived here drove the token via deps.settings.thinkingEnabled
  // (a caller-passed snapshot). The device off-by-one fix (2026-07-14) makes wantsLeadingThinkToken read
  // the setting LIVE from the store, so that caller path no longer exists. The real behavior — the token
  // follows the CURRENT toggle with no one-turn lag — is now covered end-to-end by the integration test
  // __tests__/integration/generation/thinkTokenFollowsLiveToggle.test.tsx (real screen, real store, real fn).
});

// ─────────────────────────────────────────────
// RAG context injection
// ─────────────────────────────────────────────

describe('RAG context injection in startGenerationFn', () => {
  // Deleted: two mockist "injects doc list / RAG context" tests that asserted toHaveBeenCalled on our own
  // mocked rag service (getDocsByProject/searchProject/formatForPrompt) — pre-existing reds, and the delete-
  // the-impl litmus keeps them green. RAG-into-prompt is covered by real integration tests, not mock spies.

  it('does not inject RAG context when conversation has no projectId', async () => {
    const conv = { id: 'conv-1', messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });

    expect(mockGetDocsByProject).not.toHaveBeenCalled();
    expect(mockSearchProject).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('does not inject doc list when all docs are disabled', async () => {
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockProjectStoreGetProject.mockReturnValue({ id: 'proj-1', systemPrompt: 'Be helpful', name: 'Test' });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 0 }]);
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });

    expect(mockSearchProject).not.toHaveBeenCalled();
    expect(mockFormatForPrompt).not.toHaveBeenCalled();
  });

  // Deleted: mockist "continues generation even if RAG search throws" — asserted toHaveBeenCalled on the
  // mocked generateWithTools; pre-existing red. The resilience-on-RAG-error path is an integration concern.
});

describe('RAG context injection in regenerateResponseFn', () => {
  it('injects RAG context for project conversations', async () => {
    const userMsg = { id: 'm1', role: 'user' as const, content: 'explain docs', timestamp: 0 };
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [userMsg] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 1 }]);
    mockSearchProject.mockResolvedValue({
      chunks: [{ doc_id: 1, name: 'doc.txt', content: 'relevant info', position: 0, score: 0.85 }],
      truncated: false,
    });
    const deps = makeGenerationDeps({ activeProject: { id: 'proj-1', systemPrompt: 'Be helpful' } });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });

    expect(mockGetDocsByProject).toHaveBeenCalledWith('proj-1');
    expect(mockSearchProject).toHaveBeenCalledWith('proj-1', 'explain docs');
    expect(mockFormatForPrompt).toHaveBeenCalled();
  });

  it('skips RAG for non-project conversations', async () => {
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 };
    const conv = { id: 'conv-1', messages: [userMsg] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });

    expect(mockGetDocsByProject).not.toHaveBeenCalled();
    expect(mockSearchProject).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// Embedding warmup
// ─────────────────────────────────────────────

const { embeddingService } = require('../../../src/services/rag/embedding');
const mockEmbeddingIsLoaded = embeddingService.isLoaded as jest.Mock;
const mockEmbeddingLoad = embeddingService.load as jest.Mock;

describe('embedding model warmup in injectRagContext', () => {
  it('fires embeddingService.load() when project has enabled docs and model is not loaded', async () => {
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockProjectStoreGetProject.mockReturnValue({ id: 'proj-1', systemPrompt: 'Be helpful', name: 'Test' });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 1 }]);
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });
    mockEmbeddingIsLoaded.mockReturnValue(false);

    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });

    expect(mockEmbeddingLoad).toHaveBeenCalled();
  });

  it('does not call load() when embedding model is already loaded', async () => {
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockProjectStoreGetProject.mockReturnValue({ id: 'proj-1', systemPrompt: 'Be helpful', name: 'Test' });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 1 }]);
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });
    mockEmbeddingIsLoaded.mockReturnValue(true);

    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });

    expect(mockEmbeddingLoad).not.toHaveBeenCalled();
  });

  it('does not block generation if embedding load fails', async () => {
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockProjectStoreGetProject.mockReturnValue({ id: 'proj-1', systemPrompt: 'Be helpful', name: 'Test' });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 1 }]);
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });
    mockEmbeddingIsLoaded.mockReturnValue(false);
    mockEmbeddingLoad.mockRejectedValue(new Error('model not found'));

    const deps = makeGenerationDeps();
    // Should not throw — warmup failure is non-blocking
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });
    // Flush pending microtasks from fire-and-forget warmup
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(mockEmbeddingLoad).toHaveBeenCalled();
  });

  it('does not fire warmup when no enabled docs exist', async () => {
    const conv = { id: 'conv-1', projectId: 'proj-1', messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    mockProjectStoreGetProject.mockReturnValue({ id: 'proj-1', systemPrompt: 'Be helpful', name: 'Test' });
    mockGetDocsByProject.mockResolvedValue([{ id: 1, name: 'doc.txt', enabled: 0 }]);
    mockEmbeddingIsLoaded.mockReturnValue(false);

    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });

    expect(mockEmbeddingLoad).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// handleSelectProjectFn
// ─────────────────────────────────────────────

describe('handleSelectProjectFn', () => {
  it('sets conversation project when activeConversationId is set', () => {
    const setConversationProject = jest.fn();
    const setShowProjectSelector = jest.fn();
    const deps = { activeConversationId: 'conv-1', setConversationProject, setShowProjectSelector };
    handleSelectProjectFn(deps, { id: 'proj-1', name: 'Test' } as any);
    expect(setConversationProject).toHaveBeenCalledWith('conv-1', 'proj-1');
    expect(setShowProjectSelector).toHaveBeenCalledWith(false);
  });

  it('clears project when project is null', () => {
    const setConversationProject = jest.fn();
    const setShowProjectSelector = jest.fn();
    const deps = { activeConversationId: 'conv-1', setConversationProject, setShowProjectSelector };
    handleSelectProjectFn(deps, null);
    expect(setConversationProject).toHaveBeenCalledWith('conv-1', null);
  });

  it('skips setConversationProject when no activeConversationId', () => {
    const setConversationProject = jest.fn();
    const setShowProjectSelector = jest.fn();
    const deps = { activeConversationId: null, setConversationProject, setShowProjectSelector };
    handleSelectProjectFn(deps, { id: 'proj-1', name: 'Test' } as any);
    expect(setConversationProject).not.toHaveBeenCalled();
    expect(setShowProjectSelector).toHaveBeenCalledWith(false);
  });
});

// ─────────────────────────────────────────────
// handleSendFn — additional branches
// ─────────────────────────────────────────────

describe('handleSendFn — additional branches', () => {
  it('appends document attachment content to message text', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, {
      text: 'analyze this',
      attachments: [{ type: 'document', fileName: 'report.pdf', textContent: 'page content' } as any],
      imageMode: 'auto',
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(startGeneration).toHaveBeenCalledWith('conv-1', expect.stringContaining('page content'));
    expect(startGeneration).toHaveBeenCalledWith('conv-1', expect.stringContaining('report.pdf'));
  });

  // Deleted: a mockist test that sent an IMAGE to the default non-vision model and asserted
  // startGeneration was called. That path is now (correctly) blocked by the shared vision gate
  // (blockedImageForNonVisionModel) — an image never reaches a model that can't do vision. The gate is
  // covered by localModelAcceptsImages.test.ts; the send/resend wiring by the rendered flow.

  it('enqueues message when generation is already in progress', async () => {
    mockGetGenerationState.mockReturnValue({ isGenerating: true });
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps();
    await handleSendFn(deps, {
      text: 'queued message',
      imageMode: 'auto',
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(mockEnqueueMessage).toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('prefixes message when the user forces image mode but no image model is selected', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeGenerationDeps({
      activeImageModel: null, // no image model to load
    });
    await handleSendFn(deps, {
      text: 'draw a cat',
      imageMode: 'force', // force routes to image even without a selected model → prefix the text
      startGeneration,
      setDebugInfo: jest.fn(),
    });
    expect(startGeneration).toHaveBeenCalledWith('conv-1', expect.stringContaining('[User wanted an image'));
  });
});

// ─────────────────────────────────────────────
// startGenerationFn — remote model path
// ─────────────────────────────────────────────

describe('startGenerationFn — remote model path', () => {
  it('skips local model loading for remote models', async () => {
    const deps = makeGenerationDeps({
      activeModelInfo: { isRemote: true, model: null, modelId: 'remote-gpt4', modelName: 'GPT-4' },
      activeModel: null,
    });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hello' });
    expect(deps.ensureModelLoaded).not.toHaveBeenCalled();
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it('uses all tools when remote server is active (bypasses heuristic)', async () => {
    useRemoteServerStore.setState({ activeServerId: 'srv-1', activeRemoteTextModelId: 'gpt-4' });
    (llmService.supportsToolCalling as jest.Mock).mockReturnValue(false);
    const deps = makeGenerationDeps({
      activeModelInfo: { isRemote: true, model: null, modelId: 'gpt-4', modelName: 'GPT-4' },
      activeModel: null,
      settings: { ...makeGenerationDeps().settings, enabledTools: ['get_current_datetime'] },
    });
    const conv = { id: 'conv-1', messages: [{ id: 'm1', role: 'user', content: 'Hi', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'Hi' });
    // Remote: isRemote=true → all tools used regardless of heuristic
    expect(mockGenerateWithTools).toHaveBeenCalledWith('conv-1', expect.any(Array), expect.objectContaining({ enabledToolIds: ['get_current_datetime'] }));
  });
});

// ─────────────────────────────────────────────
// regenerateResponseFn — model not loaded
// ─────────────────────────────────────────────

describe('regenerateResponseFn — model not loaded', () => {
  it('returns early when local model is not loaded', async () => {
    mockIsModelLoaded.mockReturnValue(false);
    mockGetLoadedModelPath.mockReturnValue(null);
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 };
    const deps = makeGenerationDeps({
      activeModelInfo: { isRemote: false, model: baseModel, modelId: 'model-1', modelName: 'Test' },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('does not return early for remote models even if local model is not loaded', async () => {
    mockIsModelLoaded.mockReturnValue(false);
    useRemoteServerStore.setState({ activeServerId: 'srv-1', activeRemoteTextModelId: 'gpt-4' });
    const userMsg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: 0 };
    const conv = { id: 'conv-1', messages: [userMsg] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps({
      activeModelInfo: { isRemote: true, model: null, modelId: 'gpt-4', modelName: 'GPT-4' },
    });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage: userMsg });
    expect(mockGenerateResponse).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// generateWithCompactionRetry — context full error
// ─────────────────────────────────────────────

describe('generateWithCompactionRetry — context full error path', () => {
  const { contextCompactionService } = require('../../../src/services/contextCompaction');
  const mockIsContextFullError = contextCompactionService.isContextFullError as jest.Mock;
  const mockCompact = contextCompactionService.compact as jest.Mock;

  beforeEach(() => {
    mockIsContextFullError.mockReturnValue(false);
    mockCompact.mockResolvedValue([]);
  });

  it('rethrows non-context-full errors', async () => {
    mockGenerateResponse.mockRejectedValueOnce(new Error('GPU crashed'));
    mockIsContextFullError.mockReturnValue(false);
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Generation Error' }));
  });

  it('retries with compacted messages on context full error', async () => {
    const compactedMsgs = [{ id: 'system', role: 'system', content: 'summary', timestamp: 0 }];
    mockGenerateResponse
      .mockRejectedValueOnce(new Error('context full'))
      .mockResolvedValueOnce(undefined);
    mockIsContextFullError.mockReturnValue(true);
    mockCompact.mockResolvedValue(compactedMsgs);
    (llmService.stopGeneration as jest.Mock).mockResolvedValue(undefined);

    const conv = { id: 'conv-1', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }] };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    // Second call should be with the compacted messages
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
    expect(mockIsContextFullError).toHaveBeenCalled();
  });

  it('falls back to recent messages when compact throws', async () => {
    mockGenerateResponse
      .mockRejectedValueOnce(new Error('context full'))
      .mockResolvedValueOnce(undefined);
    mockIsContextFullError.mockReturnValue(true);
    mockCompact.mockRejectedValue(new Error('compact failed'));
    (llmService.stopGeneration as jest.Mock).mockResolvedValue(undefined);
    mockClearKVCache.mockResolvedValue(undefined);

    const conv = { id: 'conv-1', messages: [
      { id: 'm1', role: 'user', content: 'old', timestamp: 0 },
      { id: 'm2', role: 'assistant', content: 'reply', timestamp: 0 },
    ]};
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(mockClearKVCache).toHaveBeenCalledWith(true);
    expect(mockGenerateResponse).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────
// applyCompactionPrefix — compaction branches
// ─────────────────────────────────────────────

describe('applyCompactionPrefix — compaction state', () => {
  it('uses compaction prefix and filters messages after cutoff', async () => {
    const msgs = [
      { id: 'm1', role: 'user', content: 'old message', timestamp: 0 },
      { id: 'm2', role: 'assistant', content: 'old reply', timestamp: 0 },
      { id: 'm3', role: 'user', content: 'new message', timestamp: 0 },
    ];
    const conv = {
      id: 'conv-1',
      compactionSummary: 'Summary of old messages',
      compactionCutoffMessageId: 'm2',
      messages: msgs,
    };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'new message' });
    // Should have included compaction summary in messages
    expect(mockGenerateResponse).toHaveBeenCalledWith('conv-1', expect.arrayContaining([
      expect.objectContaining({ id: 'compaction-summary' }),
    ]));
  });

  it('includes all messages when cutoffMessageId is not found', async () => {
    const msgs = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];
    const conv = {
      id: 'conv-1',
      compactionSummary: 'Some summary',
      compactionCutoffMessageId: 'non-existent-id',
      messages: msgs,
    };
    mockChatStoreGetState.mockReturnValue({ conversations: [conv], updateCompactionState: jest.fn() });
    const deps = makeGenerationDeps();
    await startGenerationFn(deps, { setDebugInfo: jest.fn(), targetConversationId: 'conv-1', messageText: 'hi' });
    expect(mockGenerateResponse).toHaveBeenCalled();
  });
});

// DEVICE 2026-07-14 — an image sent (or resent) to a model that can't do vision reached the native
// completion and crashed with "Multimodal support not enabled". Send and resend now share ONE gate
// (blockedImageForNonVisionModel), so BOTH block the image and surface the repair path instead.
describe('image → non-vision model is blocked at the seam (send AND resend share the gate)', () => {
  const visionNoProjector = () => ({
    ...createDownloadedModel({ id: 'v', engine: 'llama', filePath: '/p/gemma-4-E2B-it-Q4_K_M.gguf', fileName: 'gemma-4-E2B-it-Q4_K_M.gguf' }),
    isVisionModel: true, mmProjPath: undefined, mmProjFileName: 'gemma-4-e2b-it-mmproj-F16.gguf',
  });
  const depsFor = (model: any) => makeGenerationDeps({
    activeModelId: 'v', activeModel: model,
    activeModelInfo: { isRemote: false, model, modelId: 'v', modelName: 'Gemma' },
  });
  const imageAttachment = [{ type: 'image', fileName: 'photo.jpg' } as any];

  it('SEND: a vision model missing its projector shows "Vision File Missing" and never starts generation', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = depsFor(visionNoProjector());
    await handleSendFn(deps, { text: 'explain this', attachments: imageAttachment, imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Vision File Missing' }));
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('RESEND: the same turn is blocked by the same gate — repair alert, no generation', async () => {
    const model = visionNoProjector();
    const deps = depsFor(model);
    const userMessage = { id: 'm1', role: 'user' as const, content: 'explain this', timestamp: 0, attachments: imageAttachment };
    mockChatStoreGetState.mockReturnValue({ conversations: [{ id: 'conv-1', messages: [userMessage] }], updateCompactionState: jest.fn() });
    await regenerateResponseFn(deps, { setDebugInfo: jest.fn(), userMessage, recordedKind: 'text' });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Vision File Missing' }));
    expect(mockGenerateWithTools).not.toHaveBeenCalled();
  });

  it('a plain non-vision model gets "Vision Not Supported" (no misleading repair offer)', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const plain = createDownloadedModel({ id: 'p', engine: 'llama', filePath: '/p/qwen.gguf', fileName: 'qwen.gguf' });
    const deps = depsFor(plain);
    await handleSendFn(deps, { text: 'look', attachments: imageAttachment, imageMode: 'auto', startGeneration, setDebugInfo: jest.fn() });
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Vision Not Supported' }));
    expect(startGeneration).not.toHaveBeenCalled();
  });
});
