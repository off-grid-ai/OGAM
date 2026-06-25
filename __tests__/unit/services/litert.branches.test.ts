/**
 * Branch-coverage tests for litert.ts.
 *
 * These exercise the parts the main suite leaves uncovered:
 *  - loadModel success + failure paths and option defaults
 *  - resetConversation ??/|| fallbacks and JSON.stringify guards
 *  - prepareConversation compaction path vs reset path vs no-op
 *  - summarizeCurrentSession think-prefix stripping + handler install/restore
 *  - warmup ready/not-ready/error paths
 *  - sendMessage native event listeners (token/thinking/complete/error/tool_call)
 *  - generateRaw resolve/reject + tool handler wiring
 *  - generateToolSelection finally-invalidate
 *  - getContextUsage / invalidateConversation / getMemoryInfo
 *
 * The native LiteRTModule const is captured at import time, so each test that
 * needs a fresh module loads the service in an isolated module registry with
 * its own mocked react-native + liteRTCompaction.
 */

type Listener = (payload: any) => void | Promise<void>;

interface IsolatedHarness {
  service: any;
  module: Record<string, jest.Mock>;
  listeners: Record<string, Listener>;
  runCompaction: jest.Mock;
  summarizeSession: jest.Mock;
}

function buildIsolatedService(opts?: {
  withModule?: boolean;
  moduleOverrides?: Record<string, any>;
}): IsolatedHarness {
  const withModule = opts?.withModule ?? true;
  const listeners: Record<string, Listener> = {};

  const module: Record<string, jest.Mock> = {
    loadModel: jest.fn().mockResolvedValue('gpu'),
    resetConversation: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendMessageWithImages: jest.fn().mockResolvedValue(undefined),
    sendMessageWithAudio: jest.fn().mockResolvedValue(undefined),
    sendMessageWithMedia: jest.fn().mockResolvedValue(undefined),
    respondToToolCall: jest.fn().mockResolvedValue(undefined),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
    unloadModel: jest.fn().mockResolvedValue(undefined),
    getMemoryInfo: jest.fn().mockResolvedValue(null),
    ...(opts?.moduleOverrides ?? {}),
  };

  const emitter = {
    addListener: jest.fn((event: string, cb: Listener) => {
      listeners[event] = cb;
      return { remove: jest.fn() };
    }),
  };

  const runCompaction = jest.fn().mockResolvedValue(undefined);
  const summarizeSession = jest.fn().mockResolvedValue('a summary that is definitely long enough');

  let harness!: IsolatedHarness;

  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      NativeModules: withModule ? { LiteRTModule: module } : {},
      NativeEventEmitter: jest.fn(() => emitter),
      Platform: {
        OS: 'android',
        select: (spec: Record<string, any>) => spec.android ?? spec.default ?? null,
      },
    }));
    jest.doMock('../../../src/utils/logger', () => {
      const log = jest.fn();
      return { __esModule: true, default: { log, error: log, warn: log } };
    });
    jest.doMock('../../../src/services/liteRTCompaction', () => ({
      runCompaction,
      summarizeSession,
    }));

     
    const { liteRTService } = require('../../../src/services/litert');
    harness = { service: liteRTService, module, listeners, runCompaction, summarizeSession };
  });

  return harness;
}

/** Flush microtasks until the given native event has a registered listener. */
async function waitForListener(listeners: Record<string, Listener>, event: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (typeof listeners[event] === 'function') return;
    await Promise.resolve();
  }
  throw new Error(`listener "${event}" was never registered`);
}

describe('litert.ts branch coverage', () => {
  // -------------------------------------------------------------------------
  // loadModel
  // -------------------------------------------------------------------------
  describe('loadModel', () => {
    it('loads with explicit options, records backend + audio support', async () => {
      const { service, module } = buildIsolatedService();
      module.loadModel.mockResolvedValueOnce('npu');

      await service.loadModel('/m.bin', 'gpu', { supportsVision: true, supportsAudio: true, maxNumTokens: 8192 });

      expect(module.loadModel).toHaveBeenCalledWith('/m.bin', 'gpu', true, true, 8192);
      expect(service.isModelLoaded()).toBe(true);
      expect(service.getActiveBackend()).toBe('npu');
      expect(service.supportsAudio()).toBe(true);
      expect(service.getContextUsage().max).toBe(8192);
    });

    it('applies default options when opts omitted', async () => {
      const { service, module } = buildIsolatedService();
      module.loadModel.mockResolvedValueOnce('cpu');

      await service.loadModel('/m.bin', 'cpu');

      expect(module.loadModel).toHaveBeenCalledWith('/m.bin', 'cpu', false, false, 4096);
      expect(service.supportsAudio()).toBe(false);
      expect(service.getContextUsage().max).toBe(4096);
    });

    it('resets loaded/backend/audio state and rethrows when native load fails', async () => {
      const { service, module } = buildIsolatedService();
      module.loadModel.mockRejectedValueOnce(new Error('boom'));

      await expect(service.loadModel('/m.bin', 'gpu', { supportsAudio: true })).rejects.toThrow('boom');
      expect(service.isModelLoaded()).toBe(false);
      expect(service.getActiveBackend()).toBeNull();
      expect(service.supportsAudio()).toBe(false);
    });

    it('throws when the native module is unavailable', async () => {
      const { service } = buildIsolatedService({ withModule: false });
      await expect(service.loadModel('/m.bin', 'gpu')).rejects.toThrow('not available');
    });
  });

  // -------------------------------------------------------------------------
  // resetConversation
  // -------------------------------------------------------------------------
  describe('resetConversation', () => {
    it('applies sampler defaults and empty tools/history JSON, seeds token estimate', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;

      await service.resetConversation('sys-prompt');

      expect(module.resetConversation).toHaveBeenCalledWith('sys-prompt', 0.8, 40, 0.95, '', '');
      // cumulativeTokens seeded from system prompt only (10 chars / 4 = ceil 2.5 = 3)
      expect(service.getContextUsage().used).toBe(Math.ceil('sys-prompt'.length / 4));
    });

    it('uses provided sampler config + serializes tools and history', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;
      const tools = [{ function: { name: 't' } }];
      const history = [{ role: 'user' as const, content: 'hello there' }];

      await service.resetConversation('sys', {
        samplerConfig: { temperature: 0.1, topK: 5, topP: 0.5 },
        tools,
        history,
      });

      const [, temp, topK, topP, toolsJson, historyJson] = module.resetConversation.mock.calls[0];
      expect(temp).toBe(0.1);
      expect(topK).toBe(5);
      expect(topP).toBe(0.5);
      expect(toolsJson).toBe(JSON.stringify(tools));
      expect(historyJson).toBe(JSON.stringify(history));
      expect(service.getContextUsage().used).toBeGreaterThan(0);
    });

    it('treats empty tools/history arrays as empty JSON strings', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;

      await service.resetConversation('sys', { tools: [], history: [] });

      const [, , , , toolsJson, historyJson] = module.resetConversation.mock.calls[0];
      expect(toolsJson).toBe('');
      expect(historyJson).toBe('');
    });

    it('throws when not loaded', async () => {
      const { service } = buildIsolatedService();
      (service as any).loaded = false;
      await expect(service.resetConversation('sys')).rejects.toThrow('No LiteRT model loaded');
    });
  });

  // -------------------------------------------------------------------------
  // prepareConversation
  // -------------------------------------------------------------------------
  describe('prepareConversation', () => {
    it('runs compaction when an active session exceeds the threshold', async () => {
      const { service, runCompaction } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).configuredMaxTokens = 100;
      (service as any).cumulativeTokens = 90; // > 65
      const history = [
        { role: 'user' as const, content: 'a' },
        { role: 'assistant' as const, content: 'b' },
        { role: 'user' as const, content: 'c' },
        { role: 'assistant' as const, content: 'd' },
      ];

      await service.prepareConversation('conv-1', 'sys', { history });

      expect(runCompaction).toHaveBeenCalledTimes(1);
      expect((service as any).activeConversationId).toBe('conv-1');
    });

    it('uses incomingEstimate (not stale cumulative) for a new/switched session', async () => {
      const { service, runCompaction } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'other';
      (service as any).configuredMaxTokens = 100;
      (service as any).cumulativeTokens = 90; // stale, must be ignored
      // small history -> incoming estimate stays under threshold -> no compaction
      const history = [
        { role: 'user' as const, content: 'a' },
        { role: 'assistant' as const, content: 'b' },
        { role: 'user' as const, content: 'c' },
      ];

      await service.prepareConversation('conv-new', 'sys', { history });

      expect(runCompaction).not.toHaveBeenCalled();
    });

    it('compacts a switched session when incoming history is large', async () => {
      const { service, runCompaction } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'other';
      (service as any).configuredMaxTokens = 100;
      const big = 'x'.repeat(400);
      const history = [
        { role: 'user' as const, content: big },
        { role: 'assistant' as const, content: big },
        { role: 'user' as const, content: big },
      ];

      await service.prepareConversation('conv-new', 'sys', { history });

      expect(runCompaction).toHaveBeenCalledTimes(1);
    });

    it('does not compact when history has 2 or fewer turns', async () => {
      const { service, runCompaction } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).configuredMaxTokens = 100;
      (service as any).cumulativeTokens = 90;
      const history = [
        { role: 'user' as const, content: 'a' },
        { role: 'assistant' as const, content: 'b' },
      ];

      await service.prepareConversation('conv-1', 'sys', { history });

      expect(runCompaction).not.toHaveBeenCalled();
    });

    it('resets when conversationId changes (no compaction)', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'old';
      (service as any).activeSystemPrompt = 'sys';
      (service as any).activeToolsJson = '';

      await service.prepareConversation('new', 'sys');

      expect(module.resetConversation).toHaveBeenCalledTimes(1);
      expect((service as any).activeConversationId).toBe('new');
    });

    it('resets when tools change even if id + prompt match', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).activeSystemPrompt = 'sys';
      (service as any).activeToolsJson = '';

      await service.prepareConversation('conv-1', 'sys', { tools: [{ function: { name: 't' } }] });

      expect(module.resetConversation).toHaveBeenCalledTimes(1);
    });

    it('does nothing when id, prompt and tools all match', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).activeSystemPrompt = 'sys';
      (service as any).activeToolsJson = '';

      await service.prepareConversation('conv-1', 'sys');

      expect(module.resetConversation).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // summarizeCurrentSession (invoked through runCompaction's summarize cb)
  // -------------------------------------------------------------------------
  describe('summarizeCurrentSession', () => {
    it('strips the <|think|> prefix before resetting, then calls summarizeSession', async () => {
      const { service, module, runCompaction, summarizeSession } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).configuredMaxTokens = 100;
      (service as any).cumulativeTokens = 90;

      // Invoke the real summarize callback that prepareConversation passes in.
      runCompaction.mockImplementationOnce(async (params: any) => {
        await params.summarize(params.history);
      });

      const history = [
        { role: 'user' as const, content: 'a' },
        { role: 'assistant' as const, content: 'b' },
        { role: 'user' as const, content: 'c' },
        { role: 'assistant' as const, content: 'd' },
      ];

      await service.prepareConversation('conv-1', '<|think|>\nBe helpful', { history });

      // resetConversation should have been called with the think-prefix stripped
      expect(module.resetConversation).toHaveBeenCalledWith('Be helpful', 0.8, 40, 0.95, '', expect.any(String));
      expect(summarizeSession).toHaveBeenCalledTimes(1);
    });

    it('installs and restores the tool-call handler around summarization', async () => {
      const { service, runCompaction, summarizeSession } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'conv-1';
      (service as any).configuredMaxTokens = 100;
      (service as any).cumulativeTokens = 90;
      (service as any).currentToolCallHandler = null;

      let installedHandler: any;
      let restore: () => void;
      summarizeSession.mockImplementationOnce(async (_send: any, _ready: any, installToolHandler: any) => {
        restore = installToolHandler(async () => 'neutral');
        installedHandler = (service as any).currentToolCallHandler;
        restore();
        return 'long enough summary text goes here';
      });
      runCompaction.mockImplementationOnce(async (params: any) => {
        await params.summarize(params.history);
      });

      const history = [
        { role: 'user' as const, content: 'a' },
        { role: 'assistant' as const, content: 'b' },
        { role: 'user' as const, content: 'c' },
        { role: 'assistant' as const, content: 'd' },
      ];

      await service.prepareConversation('conv-1', 'sys', { history });

      expect(installedHandler).toBeInstanceOf(Function);
      // After restore, handler is back to the previous (null) value.
      expect((service as any).currentToolCallHandler).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // warmup
  // -------------------------------------------------------------------------
  describe('warmup', () => {
    it('returns early when not loaded', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = false;
      await service.warmup();
      expect(module.resetConversation).not.toHaveBeenCalled();
    });

    it('resets, sends a throwaway prompt, and clears warmup state on complete', async () => {
      const { service, module, listeners } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'leftover';
      (service as any).activeSystemPrompt = 'leftover';

      // sendMessage registers listeners then awaits module.sendMessage; resolve
      // the warmup promise by firing the complete listener after dispatch.
      module.sendMessage.mockImplementationOnce(async () => {
        listeners.litert_complete('');
      });

      await service.warmup();

      expect(module.resetConversation).toHaveBeenCalled();
      expect((service as any).activeConversationId).toBeNull();
      expect((service as any).activeSystemPrompt).toBeNull();
    });

    it('swallows errors thrown during warmup', async () => {
      const { service, module } = buildIsolatedService();
      (service as any).loaded = true;
      module.resetConversation.mockRejectedValueOnce(new Error('reset failed'));
      await expect(service.warmup()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage event listeners
  // -------------------------------------------------------------------------
  describe('sendMessage event listeners', () => {
    async function loadedHarness() {
      const h = buildIsolatedService();
      (h.service as any).loaded = true;
      return h;
    }

    it('accumulates tokens, sets ttft, and builds wall-clock stats on complete', async () => {
      const { service, listeners } = await loadedHarness();
      const onToken = jest.fn();
      const onComplete = jest.fn();
      await service.sendMessage('hi', {
        onToken,
        onReasoning: jest.fn(),
        onComplete,
        onError: jest.fn(),
      });

      listeners.litert_token('Hel');
      listeners.litert_token('lo');
      listeners.litert_complete(JSON.stringify({ prefillTokenCount: 7, decodeTokenCount: 2 }));

      expect(onToken).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenCalledWith('Hello', '', expect.objectContaining({
        prefillTokenCount: 7,
        decodeTokenCount: 2,
      }));
      // cumulative includes prefill + decode (+ reasoning estimate 0)
      expect(service.getContextUsage().used).toBe(9);
    });

    it('falls back to JS counts when benchmark JSON is empty/invalid', async () => {
      const { service, listeners } = await loadedHarness();
      const onComplete = jest.fn();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete,
        onError: jest.fn(),
      });

      listeners.litert_token('a');
      listeners.litert_complete('not-json{');

      const stats = onComplete.mock.calls[0][2];
      expect(stats.decodeTokenCount).toBe(1); // jsDecodeTokenCount fallback
    });

    it('accumulates reasoning tokens and reports them via onReasoning', async () => {
      const { service, listeners } = await loadedHarness();
      const onReasoning = jest.fn();
      const onComplete = jest.fn();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning,
        onComplete,
        onError: jest.fn(),
      });

      listeners.litert_thinking('thinking...');
      listeners.litert_complete('');

      expect(onReasoning).toHaveBeenCalledWith('thinking...');
      expect(onComplete.mock.calls[0][1]).toBe('thinking...');
    });

    it('produces a positive decode rate when multiple tokens span elapsed time', async () => {
      const { service, listeners } = await loadedHarness();
      const onComplete = jest.fn();
      const nowSpy = jest.spyOn(Date, 'now');
      // sendStart, firstToken, secondToken-skip..., complete
      nowSpy.mockReturnValueOnce(1000); // sendStart
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete,
        onError: jest.fn(),
      });
      nowSpy.mockReturnValueOnce(1100); // first token time
      listeners.litert_token('a');
      listeners.litert_token('b');
      nowSpy.mockReturnValueOnce(3100); // complete time -> 2s decode elapsed
      listeners.litert_complete('');

      const stats = onComplete.mock.calls[0][2];
      expect(stats.ttft).toBeCloseTo(0.1, 5);
      expect(stats.decodeTokensPerSecond).toBeGreaterThan(0);
      nowSpy.mockRestore();
    });

    it('reports errors via onError listener and clears the tool handler', async () => {
      const { service, listeners } = await loadedHarness();
      (service as any).currentToolCallHandler = jest.fn();
      const onError = jest.fn();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError,
      });

      listeners.litert_error('native failure');

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'native failure' }));
      expect((service as any).currentToolCallHandler).toBeNull();
    });

    it('invokes the tool handler and responds to the native tool call', async () => {
      const { service, module, listeners } = await loadedHarness();
      const handler = jest.fn().mockResolvedValue('tool-result');
      (service as any).currentToolCallHandler = handler;
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      });

      await listeners.litert_tool_call(JSON.stringify({ id: 'id1', name: 'calc', arguments: { x: 1 } }));

      expect(handler).toHaveBeenCalledWith('calc', { x: 1 });
      expect(module.respondToToolCall).toHaveBeenCalledWith('id1', 'tool-result');
    });

    it('responds with the unavailable fallback when no tool handler is set', async () => {
      const { service, module, listeners } = await loadedHarness();
      (service as any).currentToolCallHandler = null;
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      });

      await listeners.litert_tool_call(JSON.stringify({ id: 'id2', name: 'calc', arguments: {} }));

      expect(module.respondToToolCall).toHaveBeenCalledWith('id2', expect.stringContaining('Tool unavailable'));
    });

    it('swallows tool-call handling errors (invalid JSON)', async () => {
      const { service, module, listeners } = await loadedHarness();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      });

      await expect(listeners.litert_tool_call('not-json')).resolves.toBeUndefined();
      expect(module.respondToToolCall).not.toHaveBeenCalled();
    });

    it('routes to sendMessageWithMedia when both audio and images are present', async () => {
      const { service, module } = await loadedHarness();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      }, { imageUris: ['file:///a.png'], audioUris: ['file:///b.wav'] });

      expect(module.sendMessageWithMedia).toHaveBeenCalledWith('hi', ['file:///a.png'], ['file:///b.wav']);
      expect(module.sendMessage).not.toHaveBeenCalled();
    });

    it('routes to sendMessageWithAudio for audio-only turns', async () => {
      const { service, module } = await loadedHarness();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      }, { audioUris: ['file:///b.wav'] });

      expect(module.sendMessageWithAudio).toHaveBeenCalledWith('hi', ['file:///b.wav']);
      expect(module.sendMessageWithMedia).not.toHaveBeenCalled();
      expect(module.sendMessage).not.toHaveBeenCalled();
    });

    it('routes to sendMessageWithImages for image-only turns', async () => {
      const { service, module } = await loadedHarness();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      }, { imageUris: ['file:///a.png'] });

      expect(module.sendMessageWithImages).toHaveBeenCalledWith('hi', ['file:///a.png']);
      expect(module.sendMessageWithAudio).not.toHaveBeenCalled();
      expect(module.sendMessage).not.toHaveBeenCalled();
    });

    it('filters out falsy media URIs and falls back to plain sendMessage', async () => {
      const { service, module } = await loadedHarness();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      }, { imageUris: ['', undefined as any], audioUris: [] });

      expect(module.sendMessage).toHaveBeenCalledWith('hi', null);
      expect(module.sendMessageWithImages).not.toHaveBeenCalled();
    });

    it('reports native send errors via onError', async () => {
      const { service, module } = await loadedHarness();
      module.sendMessage.mockRejectedValueOnce(new Error('send boom'));
      const onError = jest.fn();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'send boom' }));
    });

    it('wraps non-Error native rejections in an Error', async () => {
      const { service, module } = await loadedHarness();
      module.sendMessage.mockRejectedValueOnce('string failure');
      const onError = jest.fn();
      await service.sendMessage('hi', {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'string failure' }));
    });
  });

  // -------------------------------------------------------------------------
  // generateRaw
  // -------------------------------------------------------------------------
  describe('generateRaw', () => {
    it('resolves with full content and stores benchmark stats', async () => {
      const { service, listeners } = buildIsolatedService();
      (service as any).loaded = true;
      const handlers = { onToken: jest.fn(), onReasoning: jest.fn(), onToolCall: jest.fn() };

      const promise = service.generateRaw('q', undefined, handlers);
      await waitForListener(listeners, 'litert_token');
      // generateRaw wires the supplied onToolCall handler before sending.
      expect((service as any).currentToolCallHandler).toBe(handlers.onToolCall);
      listeners.litert_token('out');
      listeners.litert_complete(JSON.stringify({ decodeTokenCount: 1 }));

      await expect(promise).resolves.toBe('out');
      expect(handlers.onToken).toHaveBeenCalledWith('out');
      expect(service.getLastBenchmarkStats()).toBeDefined();
      // complete clears the handler.
      expect((service as any).currentToolCallHandler).toBeNull();
    });

    it('rejects and clears the tool handler on error', async () => {
      const { service, listeners } = buildIsolatedService();
      (service as any).loaded = true;

      const promise = service.generateRaw('q');
      await Promise.resolve();
      listeners.litert_error('gen failed');

      await expect(promise).rejects.toThrow('gen failed');
      expect((service as any).currentToolCallHandler).toBeNull();
    });

    it('rejects when sendMessage rejects before listeners fire (not loaded)', async () => {
      const { service } = buildIsolatedService();
      (service as any).loaded = false; // sendMessage calls onError -> rejects
      await expect(service.generateRaw('q')).rejects.toThrow('No LiteRT model loaded');
    });
  });

  // -------------------------------------------------------------------------
  // generateToolSelection
  // -------------------------------------------------------------------------
  describe('generateToolSelection', () => {
    it('prepares a throwaway session, returns text, and invalidates afterwards', async () => {
      const { service, listeners } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'real-conv';

      const promise = service.generateToolSelection('route', 'pick a tool');
      await waitForListener(listeners, 'litert_token');
      listeners.litert_token('web_search');
      listeners.litert_complete('');

      await expect(promise).resolves.toBe('web_search');
      // finally block invalidates the conversation
      expect((service as any).activeConversationId).toBeNull();
    });

    it('still invalidates the conversation when generation errors', async () => {
      const { service, listeners } = buildIsolatedService();
      (service as any).loaded = true;
      (service as any).activeConversationId = 'real-conv';

      const promise = service.generateToolSelection('route', 'pick');
      await waitForListener(listeners, 'litert_error');
      listeners.litert_error('select boom');

      await expect(promise).rejects.toThrow('select boom');
      expect((service as any).activeConversationId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getContextUsage / invalidateConversation / getMemoryInfo
  // -------------------------------------------------------------------------
  describe('state queries', () => {
    it('getContextUsage reflects cumulative + configured max', () => {
      const { service } = buildIsolatedService();
      (service as any).cumulativeTokens = 123;
      (service as any).configuredMaxTokens = 2048;
      expect(service.getContextUsage()).toEqual({ used: 123, max: 2048 });
    });

    it('invalidateConversation clears the active conversation id', () => {
      const { service } = buildIsolatedService();
      (service as any).activeConversationId = 'conv-1';
      service.invalidateConversation();
      expect((service as any).activeConversationId).toBeNull();
    });

    it('getMemoryInfo returns null when native module unavailable', async () => {
      const { service } = buildIsolatedService({ withModule: false });
      await expect(service.getMemoryInfo()).resolves.toBeNull();
    });

    it('getMemoryInfo returns native info when available', async () => {
      const info = { totalRamMb: 1, usedRamMb: 1, availRamMb: 1, gpuPrivateMb: 0, lowMemory: false };
      const { service, module } = buildIsolatedService();
      module.getMemoryInfo.mockResolvedValueOnce(info);
      await expect(service.getMemoryInfo()).resolves.toEqual(info);
    });

    it('getMemoryInfo returns null and swallows native errors', async () => {
      const { service, module } = buildIsolatedService();
      module.getMemoryInfo.mockRejectedValueOnce(new Error('mem boom'));
      await expect(service.getMemoryInfo()).resolves.toBeNull();
    });
  });
});
