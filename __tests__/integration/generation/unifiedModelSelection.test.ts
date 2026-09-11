/**
 * Unified Model Selection Integration Tests
 *
 * Tests the flow of selecting local vs remote models and ensuring
 * generationService correctly routes to the appropriate provider.
 */

import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { providerRegistry } from '../../../src/services/providers/registry';
import { remoteServerManager } from '../../../src/services/remoteServerManager';

// Mock dependencies
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn().mockReturnValue(false),
    generateResponse: jest.fn(),
    stopGeneration: jest.fn().mockResolvedValue(''),
    getGpuInfo: jest.fn().mockReturnValue({ gpu: false, gpuBackend: null, gpuLayers: 0 }),
    getPerformanceStats: jest.fn().mockReturnValue({}),
  },
}));

jest.mock('../../../src/services/providers/registry', () => ({
  providerRegistry: {
    getProvider: jest.fn(),
    getActiveProvider: jest.fn(),
    setActiveProvider: jest.fn(),
  },
  getProviderForServer: jest.fn(),
}));

jest.mock('../../../src/stores/appStore', () => ({
  useAppStore: {
    getState: jest.fn().mockReturnValue({
      settings: {
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9,
      },
      activeModelId: null,
      hasEngagedSharePrompt: true,
      incrementTextGenerationCount: jest.fn().mockReturnValue(1),
    }),
  },
}));

jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: jest.fn().mockReturnValue({
      startStreaming: jest.fn(),
      appendToStreamingMessage: jest.fn(),
      appendToStreamingReasoningContent: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      clearStreamingMessage: jest.fn(),
    }),
  },
}));

describe('Unified Model Selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset remote server store
    useRemoteServerStore.getState().clearAllServers();
  });

  describe('Remote model selection', () => {
    it('should set active server and model ID when selecting a remote text model', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        isReady: jest.fn().mockResolvedValue(true),
        generate: jest.fn(),
        getLoadedModelId: jest.fn().mockReturnValue('llama2'),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);

      // Add a server
      const serverId = useRemoteServerStore.getState().addServer({
        name: 'Test Ollama',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      });

      // Add discovered models
      useRemoteServerStore.getState().setDiscoveredModels(serverId, [
        {
          id: 'llama2',
          name: 'Llama 2',
          serverId,
          capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
          lastUpdated: new Date().toISOString(),
        },
      ]);

      // Select remote model
      await remoteServerManager.setActiveRemoteTextModel(serverId, 'llama2');

      // Verify state was updated
      expect(useRemoteServerStore.getState().activeServerId).toBe(serverId);
      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBe('llama2');

      // Verify provider was updated
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith(serverId);
      expect(mockLoadModel).toHaveBeenCalledWith('llama2');
    });

    it('should clear remote selection when switching to local model', async () => {
      const serverId = useRemoteServerStore.getState().addServer({
        name: 'Test Server',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      });

      // Set up remote selection first
      useRemoteServerStore.getState().setActiveServerId(serverId);
      useRemoteServerStore.getState().setActiveRemoteTextModelId('llama2');

      // Clear selection
      remoteServerManager.clearActiveRemoteModel();

      // Verify state was cleared
      expect(useRemoteServerStore.getState().activeServerId).toBeNull();
      expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBeNull();
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('local');
    });

    it('should handle multiple servers with different models', async () => {
      const server1Id = useRemoteServerStore.getState().addServer({
        name: 'Server 1',
        endpoint: 'http://server1:11434',
        providerType: 'openai-compatible',
      });

      const server2Id = useRemoteServerStore.getState().addServer({
        name: 'Server 2',
        endpoint: 'http://server2:11434',
        providerType: 'openai-compatible',
      });

      // Add models to each server
      useRemoteServerStore.getState().setDiscoveredModels(server1Id, [
        {
          id: 'model-a',
          name: 'Model A',
          serverId: server1Id,
          capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
          lastUpdated: new Date().toISOString(),
        },
      ]);

      useRemoteServerStore.getState().setDiscoveredModels(server2Id, [
        {
          id: 'model-b',
          name: 'Model B',
          serverId: server2Id,
          capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: false },
          lastUpdated: new Date().toISOString(),
        },
      ]);

      // Verify we can get models from each server
      const modelA = useRemoteServerStore.getState().getModelById(server1Id, 'model-a');
      const modelB = useRemoteServerStore.getState().getModelById(server2Id, 'model-b');

      expect(modelA?.name).toBe('Model A');
      expect(modelB?.name).toBe('Model B');
    });
  });

  describe('Vision model selection', () => {
    it('should set active remote image model for vision models', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        isReady: jest.fn().mockResolvedValue(true),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);

      const serverId = useRemoteServerStore.getState().addServer({
        name: 'Vision Server',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      });

      useRemoteServerStore.getState().setDiscoveredModels(serverId, [
        {
          id: 'llava',
          name: 'LLaVA',
          serverId,
          capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false },
          lastUpdated: new Date().toISOString(),
        },
      ]);

      await remoteServerManager.setActiveRemoteImageModel(serverId, 'llava');

      expect(useRemoteServerStore.getState().activeRemoteImageModelId).toBe('llava');
      expect(useRemoteServerStore.getState().activeRemoteMediaServerIds.image).toBe(serverId);
      expect(mockLoadModel).toHaveBeenCalledWith('llava');
    });
  });

  describe('getActiveRemoteModel helpers', () => {
    it('should return null when no model is set', () => {
      const model = useRemoteServerStore.getState().getActiveRemoteTextModel();
      expect(model).toBeNull();
    });

    it('should return active model when set', () => {
      const serverId = useRemoteServerStore.getState().addServer({
        name: 'Test Server',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      });

      useRemoteServerStore.getState().setDiscoveredModels(serverId, [
        {
          id: 'test-model',
          name: 'Test Model',
          serverId,
          capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
          lastUpdated: new Date().toISOString(),
        },
      ]);

      useRemoteServerStore.getState().setActiveServerId(serverId);
      useRemoteServerStore.getState().setActiveRemoteTextModelId('test-model');

      const model = useRemoteServerStore.getState().getActiveRemoteTextModel();
      expect(model).not.toBeNull();
      expect(model?.id).toBe('test-model');
    });
  });
});
