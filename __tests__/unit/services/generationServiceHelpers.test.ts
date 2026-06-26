/**
 * Unit tests for generationServiceHelpers.ts
 * Focuses on vision guard and buildGenerationMetaImpl LiteRT branches.
 */

import { buildGenerationMetaImpl, prepareGenerationImpl, generateResponseImpl } from '../../../src/services/generationServiceHelpers';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => false),
    isCurrentlyGenerating: jest.fn(() => false),
    generateResponse: jest.fn(),
    getGpuInfo: jest.fn(() => ({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 })),
    getPerformanceStats: jest.fn(() => ({
      lastTokensPerSecond: 10,
      lastDecodeTokensPerSecond: 12,
      lastTimeToFirstToken: 0.4,
      lastGenerationTime: 2,
      lastTokenCount: 40,
    })),
  },
}));

jest.mock('../../../src/services/litert', () => ({
  liteRTService: {
    isModelLoaded: jest.fn(() => false),
    getActiveBackend: jest.fn(() => 'cpu'),
    prepareConversation: jest.fn(() => Promise.resolve()),
    sendMessage: jest.fn(() => Promise.resolve()),
    getLastBenchmarkStats: jest.fn().mockReturnValue(undefined),
  },
}));

jest.mock('../../../src/stores', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
  useChatStore: {
    getState: jest.fn(() => ({
      startStreaming: jest.fn(),
      clearStreamingMessage: jest.fn(),
      appendToStreamingMessage: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
    })),
  },
  useRemoteServerStore: {
    getState: jest.fn(() => ({
      getActiveServer: jest.fn(() => null),
      activeServerId: null,
      updateServerHealth: jest.fn(),
    })),
  },
}));

jest.mock('../../../src/stores/debugLogsStore', () => ({
  useDebugLogsStore: {
    getState: jest.fn(() => ({ addLog: jest.fn() })),
  },
}));

jest.mock('../../../src/services/generationToolLoop', () => ({
  runToolLoop: jest.fn(() => Promise.resolve()),
  buildLiteRTHistory: jest.fn(() => []),
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useAppStore, useChatStore } from '../../../src/stores';
import { liteRTService } from '../../../src/services/litert';

const mockedGetState = useAppStore.getState as jest.Mock;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

function makeLiteRTAppState(overrides: any = {}) {
  return {
    downloadedModels: [{ id: 'litert-1', name: 'LiteRT Model', engine: 'litert', ...overrides.modelProps }],
    activeModelId: 'litert-1',
    downloadedImageModels: [],
    activeImageModelId: null,
    settings: { temperature: 0.7, topP: 0.9, cacheType: 'ram', maxTokens: 512, thinkingEnabled: false },
    ...overrides.storeProps,
  };
}

describe('buildGenerationMetaImpl — remote provider path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns remote meta with estimated token count', () => {
    const { useRemoteServerStore } = require('../../../src/stores');
    useRemoteServerStore.getState.mockReturnValue({
      getActiveServer: () => ({ name: 'My Server' }),
      activeServerId: 'srv-1',
      updateServerHealth: jest.fn(),
    });

    const svc = {
      isUsingRemoteProvider: () => true,
      state: { streamingContent: 'hello world test', startTime: Date.now() - 2000 },
      totalReasoningLength: 8,
      remoteTimeToFirstToken: 0.3,
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.gpuBackend).toBe('Remote');
    expect(meta.modelName).toBe('My Server');
    expect(meta.gpu).toBe(false);
    expect(meta.tokenCount).toBeGreaterThan(0);
    expect(meta.timeToFirstToken).toBe(0.3);
  });

  it('uses fallback name when no active server', () => {
    const { useRemoteServerStore } = require('../../../src/stores');
    useRemoteServerStore.getState.mockReturnValue({
      getActiveServer: () => null,
      activeServerId: null,
      updateServerHealth: jest.fn(),
    });

    const svc = {
      isUsingRemoteProvider: () => true,
      state: { streamingContent: 'tokens', startTime: null },
      totalReasoningLength: 0,
      remoteTimeToFirstToken: undefined,
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.modelName).toBe('Remote Model');
    expect(meta.tokensPerSecond).toBeUndefined();
  });
});

describe('buildGenerationMetaImpl — llama.cpp path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns llama.cpp perf stats when model engine is not litert', () => {
    const { llmService } = require('../../../src/services/llm');
    llmService.getGpuInfo.mockReturnValue({ gpu: true, gpuBackend: 'Metal', gpuLayers: 32 });
    llmService.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 25,
      lastDecodeTokensPerSecond: 28,
      lastTimeToFirstToken: 0.6,
      lastGenerationTime: 3,
      lastTokenCount: 75,
    });

    mockedGetState.mockReturnValue({
      downloadedModels: [{ id: 'llm-1', name: 'Llama-3', engine: 'ggml' }],
      activeModelId: 'llm-1',
      downloadedImageModels: [],
      activeImageModelId: null,
      settings: { cacheType: 'flash', temperature: 0.7, topP: 0.9, maxTokens: 512, thinkingEnabled: false },
    });

    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: null,
      state: { streamingContent: '', startTime: Date.now() },
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('Metal');
    expect(meta.tokensPerSecond).toBe(25);
    expect(meta.tokenCount).toBe(75);
    expect(meta.cacheType).toBe('flash');
  });
});

describe('buildGenerationMetaImpl — LiteRT path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns real benchmark stats when liteRTBenchmarkStats is set', () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.getActiveBackend.mockReturnValue('gpu');

    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: {
        decodeTokensPerSecond: 42,
        ttft: 0.12,
        prefillTokenCount: 128,
      },
      state: { streamingContent: 'hello world', startTime: Date.now() - 2000 },
    };

    const meta = buildGenerationMetaImpl(svc);

    expect(meta.decodeTokensPerSecond).toBe(42);
    expect(meta.timeToFirstToken).toBeCloseTo(0.12, 2);
    expect(meta.tokenCount).toBe(128);
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('GPU');
  });

  it('falls back to estimate when liteRTBenchmarkStats is null', () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');

    const startTime = Date.now() - 4000;
    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: null,
      state: { streamingContent: 'abcd'.repeat(50), startTime },
    };

    const meta = buildGenerationMetaImpl(svc);

    expect(meta.tokenCount).toBe(Math.ceil(svc.state.streamingContent.length / 4));
    expect(meta.tokensPerSecond).toBeGreaterThan(0);
    expect(meta.gpu).toBe(false);
  });

  it('sets gpu=true when backend is npu', () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.getActiveBackend.mockReturnValue('npu');

    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: { decodeTokensPerSecond: 30, ttft: 0.2, prefillTokenCount: 64 },
      state: { streamingContent: '', startTime: Date.now() },
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.gpu).toBe(true);
    expect(meta.gpuBackend).toBe('NPU');
  });

  it('returns model name from downloadedModels', () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState({ modelProps: { name: 'Gemma-3' } }));
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');

    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: { decodeTokensPerSecond: 20, ttft: 0.1, prefillTokenCount: 64 },
      state: { streamingContent: '', startTime: Date.now() },
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.modelName).toBe('Gemma-3');
  });

  it('returns undefined tokensPerSecond when startTime is null (fallback path)', () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');

    const svc = {
      isUsingRemoteProvider: () => false,
      liteRTBenchmarkStats: null,
      state: { streamingContent: 'some text', startTime: null },
    };

    const meta = buildGenerationMetaImpl(svc);
    expect(meta.tokensPerSecond).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prepareGenerationImpl
// ---------------------------------------------------------------------------

function makeSvc(overrides: any = {}) {
  const state = { isGenerating: false, startTime: Date.now(), streamingContent: '', ...overrides.state };
  const svc = {
    state,
    updateState: jest.fn((patch: any) => { Object.assign(state, patch); }),
    pendingStop: null,
    abortRequested: false,
    resetState: jest.fn(),
    tokenBuffer: '',
    reasoningBuffer: '',
    totalReasoningLength: 0,
    remoteTimeToFirstToken: undefined,
    isUsingRemoteProvider: () => false,
    getCurrentProvider: () => null,
  };
  const { state: _s, ...rest } = overrides;
  return { ...svc, ...rest };
}

// Non-LiteRT store state — getActiveEngineService() returns llmService
function makeLlmAppState() {
  return {
    downloadedModels: [{ id: 'llm-1', engine: 'ggml', name: 'Llama' }],
    activeModelId: 'llm-1',
    downloadedImageModels: [],
    activeImageModelId: null,
    settings: { temperature: 0.7, topP: 0.9, cacheType: 'q8_0', maxTokens: 512, thinkingEnabled: false, liteRTTemperature: 0.7, liteRTTopP: 0.9, liteRTMaxTokens: 512 },
  };
}

describe('prepareGenerationImpl', () => {
  it('returns false immediately when already generating', async () => {
    const svc = makeSvc({ state: { isGenerating: true } });
    const result = await prepareGenerationImpl(svc, 'conv-1');
    expect(result).toBe(false);
  });

  it('throws when LiteRT active but no model loaded', async () => {
    // engine: 'litert' makes getActiveEngineService() return liteRTService → isLiteRTActive() = true
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.isModelLoaded.mockReturnValue(false);

    const svc = makeSvc();
    await expect(prepareGenerationImpl(svc, 'conv-1')).rejects.toThrow('No LiteRT model loaded');
    expect(svc.resetState).toHaveBeenCalled();
  });

  it('returns true when LiteRT active and model is loaded', async () => {
    mockedGetState.mockReturnValue(makeLiteRTAppState());
    mockedLiteRT.isModelLoaded.mockReturnValue(true);

    const svc = makeSvc();
    const result = await prepareGenerationImpl(svc, 'conv-1');
    expect(result).toBe(true);
  });

  it('throws when llama.cpp not loaded', async () => {
    const { llmService: llm } = require('../../../src/services/llm');
    llm.isModelLoaded.mockReturnValue(false);
    mockedGetState.mockReturnValue(makeLlmAppState());

    const svc = makeSvc();
    await expect(prepareGenerationImpl(svc, 'conv-1')).rejects.toThrow('No model loaded');
  });

  it('throws when llama.cpp is busy', async () => {
    const { llmService: llm } = require('../../../src/services/llm');
    llm.isModelLoaded.mockReturnValue(true);
    llm.isCurrentlyGenerating.mockReturnValue(true);
    mockedGetState.mockReturnValue(makeLlmAppState());

    const svc = makeSvc();
    await expect(prepareGenerationImpl(svc, 'conv-1')).rejects.toThrow('LLM service busy');
  });
});

// ---------------------------------------------------------------------------
// generateResponseImpl — LiteRT branch
// ---------------------------------------------------------------------------

function makeLiteRTState() {
  return {
    ...makeLiteRTAppState(),
    settings: { liteRTTemperature: 0.7, liteRTTopP: 0.9, liteRTMaxTokens: 512, cacheType: 'q8_0', temperature: 0.7, maxTokens: 512, thinkingEnabled: false, topP: 0.9 },
  };
}

function makeServiceSvc() {
  return {
    ...makeSvc(),
    flushTimer: null,
    liteRTBenchmarkStats: null,
    forceFlushTokens: jest.fn(),
    flushTokenBuffer: jest.fn(),
    checkSharePrompt: jest.fn(),
    isUsingRemoteProvider: () => false,
    getCurrentProvider: () => null,
  };
}

const makeLiteRTSvc = makeServiceSvc;
const makeLlmSvc = makeServiceSvc;

describe('generateResponseImpl — LiteRT path', () => {
  beforeEach(() => {
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
    mockedGetState.mockReturnValue(makeLiteRTState());
  });

  it('enters LiteRT path and calls prepareConversation', async () => {
    const finalize = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(), clearStreamingMessage: jest.fn(),
      appendToStreamingMessage: jest.fn(), finalizeStreamingMessage: finalize,
    });
    mockedLiteRT.sendMessage.mockImplementation((_text: any, callbacks: any) => {
      callbacks.onComplete('', '', null);
      return Promise.resolve();
    });

    await generateResponseImpl(makeLiteRTSvc(), {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'system' as const, content: 'sys' }, { id: '2', timestamp: 1, role: 'user' as const, content: 'Hello' }],
    });
    expect(mockedLiteRT.prepareConversation).toHaveBeenCalled();
    expect(finalize).toHaveBeenCalled();
  });

  it('exits early when no user message in history', async () => {
    const clear = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(), clearStreamingMessage: clear,
      appendToStreamingMessage: jest.fn(), finalizeStreamingMessage: jest.fn(),
    });

    await generateResponseImpl(makeLiteRTSvc(), {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'system' as const, content: 'sys' }],
    });
    expect(mockedLiteRT.sendMessage).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  it('calls clearStreamingMessage on sendMessage onError', async () => {
    const clear = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(), clearStreamingMessage: clear,
      appendToStreamingMessage: jest.fn(), finalizeStreamingMessage: jest.fn(),
    });
    mockedLiteRT.sendMessage.mockImplementation((_text: any, callbacks: any) => {
      callbacks.onError(new Error('gpu error'));
      return Promise.resolve();
    });

    await generateResponseImpl(makeLiteRTSvc(), {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });
    expect(clear).toHaveBeenCalled();
  });

  it('routes an audio attachment to sendMessage as audioUris when the model supports audio', async () => {
    mockedGetState.mockReturnValue({
      ...makeLiteRTState(),
      downloadedModels: [{ id: 'litert-1', name: 'Gemma 4 E2B', engine: 'litert', liteRTAudio: true }],
      activeModelId: 'litert-1',
    });
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(), clearStreamingMessage: jest.fn(),
      appendToStreamingMessage: jest.fn(), finalizeStreamingMessage: jest.fn(),
    });
    mockedLiteRT.sendMessage.mockImplementation((_t: any, callbacks: any) => {
      callbacks.onComplete('', '', null);
      return Promise.resolve();
    });

    await generateResponseImpl(makeLiteRTSvc(), {
      conversationId: 'conv-1',
      messages: [{
        id: '1', timestamp: 0, role: 'user' as const, content: '',
        attachments: [{ id: 'a', type: 'audio' as const, uri: 'file:///clip.wav' }],
      }],
    });

    expect(mockedLiteRT.sendMessage).toHaveBeenCalledWith('', expect.any(Object), { imageUris: [], audioUris: ['file:///clip.wav'] });
  });

  it('rejects an audio attachment when the active model has no audio support', async () => {
    mockedGetState.mockReturnValue({
      ...makeLiteRTState(),
      downloadedModels: [{ id: 'litert-1', name: 'Gemma vision-only', engine: 'litert', liteRTAudio: false }],
      activeModelId: 'litert-1',
    });
    const clear = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(), clearStreamingMessage: clear,
      appendToStreamingMessage: jest.fn(), finalizeStreamingMessage: jest.fn(),
    });

    await expect(generateResponseImpl(makeLiteRTSvc(), {
      conversationId: 'conv-1',
      messages: [{
        id: '1', timestamp: 0, role: 'user' as const, content: '',
        attachments: [{ id: 'a', type: 'audio' as const, uri: 'file:///clip.wav' }],
      }],
    })).rejects.toThrow(/does not support audio/);

    expect(clear).toHaveBeenCalled();
    expect(mockedLiteRT.sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateResponseImpl — llama.cpp path (isLiteRTActive = false)
// ---------------------------------------------------------------------------

describe('generateResponseImpl — llama.cpp path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetState.mockReturnValue(makeLlmAppState());
  });

  it('calls finalizeStreamingMessage on successful completion', async () => {
    const { llmService: llm } = require('../../../src/services/llm');
    llm.isModelLoaded.mockReturnValue(true);
    llm.isCurrentlyGenerating.mockReturnValue(false);

    const finalize = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(),
      clearStreamingMessage: jest.fn(),
      appendToStreamingMessage: jest.fn(),
      finalizeStreamingMessage: finalize,
    });

    llm.generateResponse.mockImplementation((_msgs: any, onChunk: any, onComplete: any) => {
      onChunk({ content: 'hello', reasoningContent: undefined });
      onChunk({ content: undefined, reasoningContent: 'thinking' });
      onComplete();
      return Promise.resolve();
    });

    await generateResponseImpl(makeLlmSvc(), {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    expect(finalize).toHaveBeenCalled();
  });

  it('clears streaming message and rethrows on generateResponse error', async () => {
    const { llmService: llm } = require('../../../src/services/llm');
    llm.isModelLoaded.mockReturnValue(true);
    llm.isCurrentlyGenerating.mockReturnValue(false);

    const clear = jest.fn();
    (useChatStore.getState as jest.Mock).mockReturnValue({
      startStreaming: jest.fn(),
      clearStreamingMessage: clear,
      appendToStreamingMessage: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
    });

    llm.generateResponse.mockRejectedValue(new Error('gpu crash'));

    await expect(
      generateResponseImpl(makeLlmSvc(), {
        conversationId: 'conv-1',
        messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      }),
    ).rejects.toThrow('gpu crash');

    expect(clear).toHaveBeenCalled();
  });
});
