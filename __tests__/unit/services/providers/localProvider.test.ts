/**
 * Local Provider Unit Tests
 *
 * Tests for the local LLM provider wrapper that delegates to llmService.
 */

import { localProvider } from '../../../../src/services/providers/localProvider';
import { llmService } from '../../../../src/services/llm';
import { Message } from '../../../../src/types';

// Mock llmService
jest.mock('../../../../src/services/llm', () => ({
  llmService: {
    loadModel: jest.fn(),
    unloadModel: jest.fn(),
    isModelLoaded: jest.fn(),
    getLoadedModelPath: jest.fn(),
    generateResponse: jest.fn(),
    generateResponseWithTools: jest.fn(),
    stopGeneration: jest.fn(),
    getTokenCount: jest.fn(),
    getGpuInfo: jest.fn(),
    getPerformanceStats: jest.fn(),
    supportsVision: jest.fn(),
    supportsToolCalling: jest.fn(),
    supportsThinking: jest.fn(),
    isCurrentlyGenerating: jest.fn(),
  },
}));

describe('LocalProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('properties', () => {
    it('should have correct id', () => {
      expect(localProvider.id).toBe('local');
    });

    it('should have correct type', () => {
      expect(localProvider.type).toBe('local');
    });

    it('should return capabilities from llmService', () => {
      (llmService.supportsVision as jest.Mock).mockReturnValue(true);
      (llmService.supportsToolCalling as jest.Mock).mockReturnValue(true);
      (llmService.supportsThinking as jest.Mock).mockReturnValue(false);

      const caps = localProvider.capabilities;

      expect(caps.supportsVision).toBe(true);
      expect(caps.supportsToolCalling).toBe(true);
      expect(caps.supportsThinking).toBe(false);
    });
  });

  describe('loadModel', () => {
    it('should track model ID when loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(false);
      (llmService.loadModel as jest.Mock).mockResolvedValue(undefined);

      await localProvider.loadModel('/path/to/model.gguf');

      expect(localProvider.getLoadedModelId()).toBe('/path/to/model.gguf');
    });
  });

  describe('unloadModel', () => {
    it('should call llmService.unloadModel', async () => {
      (llmService.unloadModel as jest.Mock).mockResolvedValue(undefined);

      await localProvider.unloadModel();

      expect(llmService.unloadModel).toHaveBeenCalled();
      expect(localProvider.getLoadedModelId()).toBeNull();
    });
  });

  describe('isModelLoaded', () => {
    it('should delegate to llmService', () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);

      expect(localProvider.isModelLoaded()).toBe(true);
      expect(llmService.isModelLoaded).toHaveBeenCalled();
    });
  });

  describe('generate', () => {
    it('should call llmService.generateResponse for simple generation', async () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
      ];

      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponse as jest.Mock).mockImplementation(
        async (_msgs, { onStream, onComplete } = {}) => {
          onStream?.({ content: 'Hi' });
          onComplete?.({ content: 'Hi', reasoningContent: '' });
          return 'Hi';
        }
      );
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({
        lastTokensPerSecond: 10,
        lastDecodeTokensPerSecond: 8,
        lastTimeToFirstToken: 0.5,
        lastGenerationTime: 1000,
        lastTokenCount: 10,
      });

      const onToken = jest.fn();
      const onComplete = jest.fn();

      await localProvider.generate(
        messages,
        { temperature: 0.7 },
        { onToken, onComplete, onError: jest.fn() }
      );

      expect(llmService.generateResponse).toHaveBeenCalled();
      expect(onToken).toHaveBeenCalledWith('Hi');
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hi',
        })
      );
    });

    it('should call llmService.generateResponseWithTools when tools provided', async () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Search for weather', timestamp: Date.now() },
      ];

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponseWithTools as jest.Mock).mockResolvedValue({
        fullResponse: 'The weather is sunny',
        toolCalls: [],
      });
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({
        lastTokensPerSecond: 10,
        lastDecodeTokensPerSecond: 8,
        lastTimeToFirstToken: 0.5,
        lastGenerationTime: 1000,
        lastTokenCount: 10,
      });

      const onToken = jest.fn();
      const onComplete = jest.fn();

      await localProvider.generate(
        messages,
        { tools },
        { onToken, onComplete, onError: jest.fn() }
      );

      expect(llmService.generateResponseWithTools).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ tools })
      );
    });

    it('should call onError when no model is loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(false);

      const onError = jest.fn();
      const onComplete = jest.fn();

      await localProvider.generate(
        [],
        {},
        { onToken: jest.fn(), onComplete, onError }
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('No model loaded');
    });

    it('calls onReasoning during simple generation when callback provided', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponse as jest.Mock).mockImplementation(
        async (_msgs, { onStream, onComplete } = {}) => {
          onStream?.({ content: 'token', reasoningContent: 'thinking...' });
          onComplete?.({ content: 'token', reasoningContent: 'thinking...' });
        }
      );
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({ lastTokensPerSecond: 1, lastDecodeTokensPerSecond: 1, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 1 });

      const onReasoning = jest.fn();
      await localProvider.generate([], {}, { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn(), onReasoning });

      expect(onReasoning).toHaveBeenCalledWith('thinking...');
    });

    it('calls onReasoning during tool generation when callback provided', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponseWithTools as jest.Mock).mockImplementation(
        async (_msgs, opts) => {
          opts.onStream?.({ content: '', reasoningContent: 'deep thought' });
          return { fullResponse: 'done', toolCalls: [] };
        }
      );
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({ lastTokensPerSecond: 1, lastDecodeTokensPerSecond: 1, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 1 });

      const tools = [{ type: 'function' as const, function: { name: 'test', description: 'd', parameters: { type: 'object', properties: {} } } }];
      const onReasoning = jest.fn();
      await localProvider.generate([], { tools }, { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn(), onReasoning });

      expect(onReasoning).toHaveBeenCalledWith('deep thought');
    });

    it('passes string tool arguments through unchanged', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponseWithTools as jest.Mock).mockResolvedValue({
        fullResponse: 'ok',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: '{"query":"test"}' }],
      });
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({ lastTokensPerSecond: 1, lastDecodeTokensPerSecond: 1, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 1 });

      const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'd', parameters: { type: 'object', properties: {} } } }];
      const onComplete = jest.fn();
      await localProvider.generate([], { tools }, { onToken: jest.fn(), onComplete, onError: jest.fn() });

      expect(onComplete.mock.calls[0][0].toolCalls[0].arguments).toBe('{"query":"test"}');
    });

    it('serializes object tool arguments to JSON string', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponseWithTools as jest.Mock).mockResolvedValue({
        fullResponse: 'ok',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
      });
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({ lastTokensPerSecond: 1, lastDecodeTokensPerSecond: 1, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 1 });

      const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'd', parameters: { type: 'object', properties: {} } } }];
      const onComplete = jest.fn();
      await localProvider.generate([], { tools }, { onToken: jest.fn(), onComplete, onError: jest.fn() });

      expect(onComplete.mock.calls[0][0].toolCalls[0].arguments).toBe('{"query":"test"}');
    });

    it('calls onError for non-Error exceptions thrown during generation', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.generateResponse as jest.Mock).mockRejectedValue('string error');
      (llmService.getGpuInfo as jest.Mock).mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 });
      (llmService.getPerformanceStats as jest.Mock).mockReturnValue({ lastTokensPerSecond: 1, lastDecodeTokensPerSecond: 1, lastTimeToFirstToken: 0, lastGenerationTime: 0, lastTokenCount: 1 });

      const onError = jest.fn();
      await localProvider.generate([], {}, { onToken: jest.fn(), onComplete: jest.fn(), onError });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('dispose', () => {
    it('unloads model and clears loadedModelId', async () => {
      (llmService.unloadModel as jest.Mock).mockResolvedValue(undefined);
      (llmService.loadModel as jest.Mock).mockResolvedValue(undefined);

      await localProvider.loadModel('/some/model.gguf');
      expect(localProvider.getLoadedModelId()).toBe('/some/model.gguf');

      await (localProvider as any).dispose();
      expect(llmService.unloadModel).toHaveBeenCalled();
      expect(localProvider.getLoadedModelId()).toBeNull();
    });
  });

  describe('stopGeneration', () => {
    it('should call llmService.stopGeneration', async () => {
      (llmService.stopGeneration as jest.Mock).mockResolvedValue(undefined);

      await localProvider.stopGeneration();

      expect(llmService.stopGeneration).toHaveBeenCalled();
    });
  });

  describe('getTokenCount', () => {
    it('should delegate to llmService when model is loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);
      (llmService.getTokenCount as jest.Mock).mockResolvedValue(10);

      const count = await localProvider.getTokenCount('Hello world');

      expect(count).toBe(10);
      expect(llmService.getTokenCount).toHaveBeenCalledWith('Hello world');
    });

    it('should estimate token count when no model loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(false);

      const count = await localProvider.getTokenCount('Hello world');

      expect(count).toBe(3); // ~12 chars / 4
    });
  });

  describe('isReady', () => {
    it('should return true when model is loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(true);

      const ready = await localProvider.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when no model is loaded', async () => {
      (llmService.isModelLoaded as jest.Mock).mockReturnValue(false);

      const ready = await localProvider.isReady();

      expect(ready).toBe(false);
    });
  });
});