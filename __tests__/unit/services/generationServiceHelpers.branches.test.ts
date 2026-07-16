/**
 * generationServiceHelpers.ts — branch-coverage tests.
 *
 * Targets branches not exercised by generationServiceHelpers.test.ts:
 *  - assertLiteRTImageSupport throws when the model lacks vision (lines 197-199)
 *  - runLiteRTResponseImpl onToken/onReasoning callbacks: TTFT capture, first-token
 *    thinking flip, abort guards, flushTimer scheduling (lines 257-282)
 *  - runLiteRTResponseImpl catch block on sendMessage rejection (lines 304-309)
 *  - generateRemoteWithToolsImpl early return when prepareGeneration is false (lines 463-464)
 *  - generateRemoteWithToolsImpl provider-missing throw + happy-path finalize
 */

import {
  generateResponseImpl,
  generateRemoteWithToolsImpl,
  generateRemoteResponseImpl,
  buildToolLoopHandlersImpl,
} from '../../../src/services/generationServiceHelpers';

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
  useAppStore: { getState: jest.fn() },
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
  useDebugLogsStore: { getState: jest.fn(() => ({ addLog: jest.fn() })) },
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
import { runToolLoop } from '../../../src/services/generationToolLoop';

const mockedGetState = useAppStore.getState as jest.Mock;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockedRunToolLoop = runToolLoop as jest.Mock;

function liteRTAppState(modelProps: any = {}) {
  return {
    downloadedModels: [{ id: 'litert-1', name: 'LiteRT', engine: 'litert', ...modelProps }],
    activeModelId: 'litert-1',
    downloadedImageModels: [],
    activeImageModelId: null,
    settings: { liteRTTemperature: 0.7, liteRTTopP: 0.9, temperature: 0.7, topP: 0.9, maxTokens: 512, thinkingEnabled: false, cacheType: 'q8_0' },
  };
}

function makeServiceSvc(overrides: any = {}) {
  const state = { isGenerating: false, isThinking: true, startTime: Date.now() - 1000, streamingContent: '', ...overrides.state };
  const { state: _s, ...rest } = overrides;
  return {
    state,
    updateState: jest.fn((patch: any) => Object.assign(state, patch)),
    resetState: jest.fn(),
    pendingStop: null,
    abortRequested: false,
    tokenBuffer: '',
    reasoningBuffer: '',
    totalReasoningLength: 0,
    remoteTimeToFirstToken: undefined,
    flushTimer: null,
    liteRTBenchmarkStats: null,
    forceFlushTokens: jest.fn(),
    flushTokenBuffer: jest.fn(),
    checkSharePrompt: jest.fn(),
    isUsingRemoteProvider: () => false,
    getCurrentProvider: () => null,
    ...rest,
  };
}

function chatStoreMock(overrides: any = {}) {
  const store = {
    startStreaming: jest.fn(),
    clearStreamingMessage: jest.fn(),
    appendToStreamingMessage: jest.fn(),
    finalizeStreamingMessage: jest.fn(),
    ...overrides,
  };
  (useChatStore.getState as jest.Mock).mockReturnValue(store);
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedLiteRT.isModelLoaded.mockReturnValue(true);
  mockedLiteRT.prepareConversation.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// assertLiteRTImageSupport — vision guard (lines 197-199)
// ---------------------------------------------------------------------------
describe('runLiteRTResponseImpl — image support guard', () => {
  it('rejects an image attachment when the active model has no vision support', async () => {
    mockedGetState.mockReturnValue(liteRTAppState({ liteRTVision: false }));
    const store = chatStoreMock();
    const svc = makeServiceSvc();

    await expect(
      generateResponseImpl(svc, {
        conversationId: 'conv-1',
        messages: [{
          id: '1', timestamp: 0, role: 'user' as const, content: 'look',
          attachments: [{ id: 'i', type: 'image' as const, uri: 'file:///pic.png' }],
        }],
      }),
    ).rejects.toThrow(/does not support images/);

    expect(store.clearStreamingMessage).toHaveBeenCalled();
    expect(svc.resetState).toHaveBeenCalled();
    expect(mockedLiteRT.sendMessage).not.toHaveBeenCalled();
  });

  it('accepts an image attachment when the model has vision enabled', async () => {
    mockedGetState.mockReturnValue(liteRTAppState({ liteRTVision: true }));
    chatStoreMock();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      cbs.onComplete('', '', null);
      return Promise.resolve();
    });

    const svc = makeServiceSvc();
    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{
        id: '1', timestamp: 0, role: 'user' as const, content: 'look',
        attachments: [{ id: 'i', type: 'image' as const, uri: 'file:///pic.png' }],
      }],
    });

    expect(mockedLiteRT.sendMessage).toHaveBeenCalledWith(
      'look', expect.any(Object), { imageUris: ['file:///pic.png'], audioUris: [] },
    );
  });
});

// ---------------------------------------------------------------------------
// runLiteRTResponseImpl — onToken / onReasoning callbacks (lines 257-282)
// ---------------------------------------------------------------------------
describe('runLiteRTResponseImpl — streaming callbacks', () => {
  beforeEach(() => {
    mockedGetState.mockReturnValue(liteRTAppState());
  });

  it('captures TTFT, flips isThinking, accumulates tokens and schedules a flush on first token', async () => {
    chatStoreMock();
    const onFirstToken = jest.fn();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      cbs.onToken('he');
      cbs.onToken('llo'); // second token: firstTokenReceived already true, flushTimer set
      cbs.onComplete('hello', '', { decodeTokensPerSecond: 9, ttft: 0.5, prefillTokenCount: 4 });
      return Promise.resolve();
    });

    const svc = makeServiceSvc();
    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      onFirstToken,
    });

    expect(onFirstToken).toHaveBeenCalledTimes(1);
    expect(svc.updateState).toHaveBeenCalledWith({ isThinking: false });
    expect(svc.state.streamingContent).toBe('hello');
    expect(svc.tokenBuffer).toBe('hello');
    // a flush was scheduled on the first token
    expect(svc.flushTimer).not.toBeNull();
    expect(svc.forceFlushTokens).toHaveBeenCalled();
    // onComplete overrides stats.ttft with the JS-measured TTFT
    expect(svc.liteRTBenchmarkStats.ttft).toBeDefined();
  });

  it('onToken ignores tokens after abort and does not accumulate', async () => {
    chatStoreMock();
    const svc = makeServiceSvc();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      // prepareGeneration clears abortRequested, so abort just before the token arrives.
      svc.abortRequested = true;
      cbs.onToken('ignored');
      return Promise.resolve();
    });

    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    expect(svc.state.streamingContent).toBe('');
    expect(svc.tokenBuffer).toBe('');
  });

  it('onReasoning accumulates into the reasoning buffer and schedules a flush', async () => {
    chatStoreMock();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      cbs.onReasoning('thinking...');
      cbs.onComplete('', 'thinking...', null);
      return Promise.resolve();
    });

    const svc = makeServiceSvc();
    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    expect(svc.reasoningBuffer).toBe('thinking...');
    expect(svc.flushTimer).not.toBeNull();
  });

  it('onReasoning is a no-op once aborted', async () => {
    chatStoreMock();
    const svc = makeServiceSvc();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      svc.abortRequested = true;
      cbs.onReasoning('late');
      return Promise.resolve();
    });

    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    expect(svc.reasoningBuffer).toBe('');
  });

  it('does not re-capture TTFT when startTime is unset', async () => {
    chatStoreMock();
    mockedLiteRT.sendMessage.mockImplementation((_t: any, cbs: any) => {
      cbs.onToken('x');
      cbs.onComplete('x', '', null);
      return Promise.resolve();
    });

    // startTime null -> the `svc.state.startTime` guard in onToken is false
    const svc = makeServiceSvc({ state: { startTime: null } });
    await generateResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    // onComplete falls back to stats?.ttft (null stats -> stats stays null)
    expect(svc.liteRTBenchmarkStats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runLiteRTResponseImpl — sendMessage rejection catch block (lines 304-309)
// ---------------------------------------------------------------------------
describe('runLiteRTResponseImpl — catch block', () => {
  beforeEach(() => {
    mockedGetState.mockReturnValue(liteRTAppState());
  });

  // (Removed: asserted clearStreamingMessage on a sendMessage reject — the SUPERSEDED discard-on-error
  // behavior. Error now flushes + finalizes the shown partial (keepShownPartialOnError); the real
  // flush/reset/never-discard path is covered by errorKeepsPartial.rendered.redflow.test.tsx.)

  it('swallows a sendMessage rejection when the request was aborted', async () => {
    chatStoreMock();
    const svc = makeServiceSvc();
    mockedLiteRT.sendMessage.mockImplementation(() => {
      // prepareGeneration clears abortRequested; re-set it so the catch abort guard hits.
      svc.abortRequested = true;
      return Promise.reject(new Error('aborted mid-flight'));
    });

    // abort guard returns before rethrow -> resolves rather than rejecting
    await expect(
      generateResponseImpl(svc, {
        conversationId: 'conv-1',
        messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateRemoteWithToolsImpl (lines 463-464 + provider guard + finalize)
// ---------------------------------------------------------------------------
describe('generateRemoteWithToolsImpl', () => {
  it('returns early when prepareGeneration reports it cannot start (lines 463-464)', async () => {
    mockedGetState.mockReturnValue(liteRTAppState());
    chatStoreMock();
    // isGenerating already true -> prepareGenerationImpl returns false immediately
    const svc = makeServiceSvc({ state: { isGenerating: true } });

    await generateRemoteWithToolsImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      options: { enabledToolIds: ['web_search'] },
    });

    expect(mockedRunToolLoop).not.toHaveBeenCalled();
    expect(svc.forceFlushTokens).not.toHaveBeenCalled();
  });

  it('throws when no remote provider is available', async () => {
    mockedGetState.mockReturnValue(liteRTAppState());
    chatStoreMock();
    const svc = makeServiceSvc({ getCurrentProvider: () => null });

    await expect(
      generateRemoteWithToolsImpl(svc, {
        conversationId: 'conv-1',
        messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
        options: { enabledToolIds: ['web_search'] },
      }),
    ).rejects.toThrow('No remote provider available');
    expect(svc.resetState).toHaveBeenCalled();
  });

  it('runs the tool loop and finalizes when a provider is present and not aborted', async () => {
    mockedGetState.mockReturnValue(liteRTAppState());
    const store = chatStoreMock();
    const provider = { type: 'openai', capabilities: { supportsThinking: false } };
    const svc = makeServiceSvc({
      getCurrentProvider: () => provider,
      state: { isGenerating: false, startTime: Date.now() - 500, streamingContent: 'done' },
    });

    await generateRemoteWithToolsImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      options: { enabledToolIds: ['web_search'], projectId: 'proj-1' },
    });

    expect(mockedRunToolLoop).toHaveBeenCalledWith(expect.objectContaining({ forceRemote: true }));
    expect(svc.forceFlushTokens).toHaveBeenCalled();
    expect(store.finalizeStreamingMessage).toHaveBeenCalled();
    expect(svc.checkSharePrompt).toHaveBeenCalled();
    expect(svc.resetState).toHaveBeenCalled();
  });

  it('skips finalize when the generation was aborted during the tool loop', async () => {
    mockedGetState.mockReturnValue(liteRTAppState());
    const store = chatStoreMock();
    const provider = { type: 'openai', capabilities: { supportsThinking: false } };
    const svc = makeServiceSvc({ getCurrentProvider: () => provider });
    // prepareGeneration clears abortRequested; the tool loop aborts mid-run.
    mockedRunToolLoop.mockImplementationOnce(() => { svc.abortRequested = true; return Promise.resolve(); });

    await generateRemoteWithToolsImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      options: { enabledToolIds: [] },
    });

    expect(mockedRunToolLoop).toHaveBeenCalled();
    expect(store.finalizeStreamingMessage).not.toHaveBeenCalled();
    expect(svc.forceFlushTokens).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildToolLoopHandlersImpl — handler closures (lines 107-141)
// ---------------------------------------------------------------------------
describe('buildToolLoopHandlersImpl', () => {
  it('isAborted reflects svc.abortRequested and onThinkingDone flips isThinking', () => {
    const svc = makeServiceSvc({ abortRequested: true });
    const handlers = buildToolLoopHandlersImpl(svc);
    expect(handlers.isAborted()).toBe(true);
    handlers.onThinkingDone();
    expect(svc.updateState).toHaveBeenCalledWith({ isThinking: false });
  });

  it('onStream accumulates content, captures remote TTFT on first content token, and schedules a flush', () => {
    const svc = makeServiceSvc({ state: { streamingContent: '', startTime: Date.now() - 200 } });
    const handlers = buildToolLoopHandlersImpl(svc);

    handlers.onStream({ content: 'first' });
    expect(svc.state.streamingContent).toBe('first');
    expect(svc.tokenBuffer).toBe('first');
    // first content token (streamingContent was empty) -> TTFT captured
    expect(svc.remoteTimeToFirstToken).toBeGreaterThanOrEqual(0);
    expect(svc.flushTimer).not.toBeNull();
  });

  it('onStream string form is normalised to a content chunk', () => {
    const svc = makeServiceSvc({ state: { streamingContent: '', startTime: null } });
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onStream('plain');
    expect(svc.state.streamingContent).toBe('plain');
    // startTime null -> TTFT stays undefined
    expect(svc.remoteTimeToFirstToken).toBeUndefined();
  });

  it('onStream routes reasoning chunks into the reasoning buffer', () => {
    const svc = makeServiceSvc();
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onStream({ reasoningContent: 'pondering' });
    expect(svc.reasoningBuffer).toBe('pondering');
    expect(svc.totalReasoningLength).toBe('pondering'.length);
  });

  it('onStream is a no-op once aborted', () => {
    const svc = makeServiceSvc({ abortRequested: true });
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onStream({ content: 'ignored' });
    expect(svc.state.streamingContent).toBe('');
  });

  it('onStreamReset flushes pending tokens and clears the streaming buffers', () => {
    const svc = makeServiceSvc({ state: { streamingContent: 'partial' }, tokenBuffer: 'partial' });
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onStreamReset();
    expect(svc.forceFlushTokens).toHaveBeenCalled();
    expect(svc.state.streamingContent).toBe('');
    expect(svc.tokenBuffer).toBe('');
  });

  it('onFinalResponse sets streaming content and appends to the chat store', () => {
    const store = chatStoreMock();
    const svc = makeServiceSvc();
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onFinalResponse('the answer');
    expect(svc.state.streamingContent).toBe('the answer');
    expect(store.appendToStreamingMessage).toHaveBeenCalledWith('the answer');
  });

  it('does not re-capture TTFT when streamingContent is already non-empty', () => {
    const svc = makeServiceSvc({ state: { streamingContent: 'prior', startTime: Date.now() - 200 } });
    const handlers = buildToolLoopHandlersImpl(svc);
    handlers.onStream({ content: 'more' });
    // streamingContent was not empty -> TTFT capture guard is skipped
    expect(svc.remoteTimeToFirstToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateRemoteResponseImpl (lines 375-452)
// ---------------------------------------------------------------------------
describe('generateRemoteResponseImpl', () => {
  beforeEach(() => {
    mockedGetState.mockReturnValue(liteRTAppState());
  });

  function makeProvider(generate: jest.Mock) {
    return { type: 'openai', capabilities: { supportsThinking: true }, generate };
  }

  it('throws when no provider is available', async () => {
    chatStoreMock();
    const svc = makeServiceSvc({ getCurrentProvider: () => null });
    await expect(
      generateRemoteResponseImpl(svc, {
        conversationId: 'conv-1',
        messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      }),
    ).rejects.toThrow('No remote provider available');
    expect(svc.resetState).toHaveBeenCalled();
  });

  it('streams tokens + reasoning, captures TTFT on first token, and finalizes on complete', async () => {
    const store = chatStoreMock();
    const generate = jest.fn(async (_m: any, _o: any, cbs: any) => {
      cbs.onToken('he');
      cbs.onToken('llo'); // second token: firstTokenReceived already true
      cbs.onReasoning('why');
      cbs.onComplete({ content: 'hello' });
    });
    const svc = makeServiceSvc({
      getCurrentProvider: () => makeProvider(generate),
      state: { streamingContent: '', startTime: Date.now() - 300 },
    });

    await generateRemoteResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
      onFirstToken: jest.fn(),
    });

    expect(svc.state.streamingContent).toBe('hello'); // he + llo
    expect(svc.reasoningBuffer).toBe('why');
    expect(svc.totalReasoningLength).toBe(3);
    expect(svc.remoteTimeToFirstToken).toBeGreaterThanOrEqual(0);
    expect(store.finalizeStreamingMessage).toHaveBeenCalled();
    expect(svc.checkSharePrompt).toHaveBeenCalled();
    expect(svc.resetState).toHaveBeenCalled();
    // currentRemoteAbortController is reset in the finally block
    expect(svc.currentRemoteAbortController).toBeNull();
  });

  // (Removed: asserted clearStreamingMessage on a remote generate reject — the SUPERSEDED discard
  // behavior (the offline-mark + resetState still hold, but error now finalizes the shown partial,
  // not clears it). Remote-failure UX is covered by remoteFailureClearsLoading.test.ts.)

  it('ignores callbacks fired after the generation was aborted', async () => {
    const store = chatStoreMock();
    const generate = jest.fn(async (_m: any, _o: any, cbs: any) => {
      // Abort the per-generation controller, then fire callbacks — all should no-op.
      svc.currentRemoteAbortController.abort();
      cbs.onToken('x');
      cbs.onReasoning('y');
      cbs.onComplete({ content: 'z' });
    });
    const svc: any = makeServiceSvc({
      getCurrentProvider: () => makeProvider(generate),
      state: { streamingContent: '', startTime: Date.now() },
    });

    await generateRemoteResponseImpl(svc, {
      conversationId: 'conv-1',
      messages: [{ id: '1', timestamp: 0, role: 'user' as const, content: 'hi' }],
    });

    expect(svc.state.streamingContent).toBe('');
    expect(svc.reasoningBuffer).toBe('');
    expect(store.finalizeStreamingMessage).not.toHaveBeenCalled();
  });
});
