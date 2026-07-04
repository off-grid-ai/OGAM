/**
 * Remote Server Manager Unit Tests
 *
 * Tests for managing remote LLM server connections and provider selection.
 */

import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { detectVisionCapability, detectToolCallingCapability } from '../../../src/services/remoteServerManagerUtils';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { providerRegistry } from '../../../src/services/providers/registry';
import * as Keychain from 'react-native-keychain';

// Mock dependencies
jest.mock('../../../src/stores/remoteServerStore');
jest.mock('../../../src/services/providers/registry');
jest.mock('../../../src/services/providers/openAICompatibleProvider', () => ({
  createOpenAIProvider: jest.fn().mockReturnValue({ dispose: jest.fn().mockResolvedValue(undefined) }),
  OpenAICompatibleProvider: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(null),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  },
}));

describe('remoteServerManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addServer', () => {
    it('should add server without API key', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434', createdAt: Date.now() };
      const mockAddServer = jest.fn().mockReturnValue('server-1');
      const mockGetServerById = jest.fn().mockReturnValue(mockServer);

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        servers: [],
        addServer: mockAddServer,
        getServerById: mockGetServerById,
      });
      (providerRegistry.registerProvider as jest.Mock).mockReturnValue(undefined);
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      const result = await remoteServerManager.addServer({
        name: 'Test',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      });

      expect(result).toEqual(mockServer);
      expect(mockAddServer).toHaveBeenCalled();
    });

    it('should add server with API key and store it', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434', createdAt: Date.now() };
      const mockAddServer = jest.fn().mockReturnValue('server-1');
      const mockGetServerById = jest.fn().mockReturnValue(mockServer);

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        servers: [],
        addServer: mockAddServer,
        getServerById: mockGetServerById,
      });
      (providerRegistry.registerProvider as jest.Mock).mockReturnValue(undefined);
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      const result = await remoteServerManager.addServer({
        name: 'Test',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
        apiKey: 'secret-key',
      });

      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'server_server-1',
        'secret-key',
        expect.objectContaining({ service: expect.stringContaining('server-1') })
      );
      expect(result).toEqual(mockServer);
    });

    it('should throw when server creation fails', async () => {
      const mockAddServer = jest.fn().mockReturnValue('server-1');
      const mockGetServerById = jest.fn().mockReturnValue(null);

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        servers: [],
        addServer: mockAddServer,
        getServerById: mockGetServerById,
      });

      await expect(remoteServerManager.addServer({
        name: 'Test',
        endpoint: 'http://localhost:11434',
        providerType: 'openai-compatible',
      })).rejects.toThrow('Failed to create server');
    });
  });

  describe('updateServer', () => {
    it('should update server without API key change', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434', createdAt: Date.now() };
      const mockGetServerById = jest.fn().mockReturnValue(mockServer);
      const mockUpdateServer = jest.fn();

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: mockGetServerById,
        updateServer: mockUpdateServer,
      });
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);

      await remoteServerManager.updateServer('server-1', { name: 'Updated' });

      expect(mockUpdateServer).toHaveBeenCalledWith('server-1', { name: 'Updated' });
    });

    it('should update server with new API key', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434', createdAt: Date.now() };
      const mockGetServerById = jest.fn().mockReturnValue(mockServer);
      const mockUpdateServer = jest.fn();

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: mockGetServerById,
        updateServer: mockUpdateServer,
      });
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      await remoteServerManager.updateServer('server-1', { apiKey: 'new-key' });

      expect(Keychain.setGenericPassword).toHaveBeenCalled();
      expect(mockUpdateServer).toHaveBeenCalledWith('server-1', {});
    });

    it('should remove API key when set to empty string', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434', createdAt: Date.now() };
      const mockGetServerById = jest.fn().mockReturnValue(mockServer);
      const mockUpdateServer = jest.fn();

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: mockGetServerById,
        updateServer: mockUpdateServer,
      });
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await remoteServerManager.updateServer('server-1', { apiKey: '' });

      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('should throw when server not found', async () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(null),
      });

      await expect(remoteServerManager.updateServer('nonexistent', { name: 'Test' }))
        .rejects.toThrow('Server not found');
    });
  });

  describe('removeServer', () => {
    it('should remove server and clean up', async () => {
      const mockRemoveServer = jest.fn();

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        removeServer: mockRemoveServer,
      });
      (providerRegistry.unregisterProvider as jest.Mock).mockReturnValue(undefined);
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await remoteServerManager.removeServer('server-1');

      expect(providerRegistry.unregisterProvider).toHaveBeenCalledWith('server-1');
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
      expect(mockRemoveServer).toHaveBeenCalledWith('server-1');
    });
  });

  describe('getApiKey', () => {
    it('should return API key from keychain', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'server_server-1',
        password: 'secret-key', // NOSONAR - test mock value, not a real credential
      });

      const key = await remoteServerManager.getApiKey('server-1');

      expect(key).toBe('secret-key');
    });

    it('should return null when no key stored', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      const key = await remoteServerManager.getApiKey('server-1');

      expect(key).toBeNull();
    });

    it('should return null on keychain error', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(new Error('Keychain error'));

      const key = await remoteServerManager.getApiKey('server-1');

      expect(key).toBeNull();
    });
  });

  describe('getServerWithApiKey', () => {
    it('should return server with API key', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(mockServer),
      });
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'server_server-1',
        password: 'secret-key', // NOSONAR - test mock value, not a real credential
      });

      const result = await remoteServerManager.getServerWithApiKey('server-1');

      expect(result).toEqual({ ...mockServer, apiKey: 'secret-key' });
    });

    it('should return null when server not found', async () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(null),
      });

      const result = await remoteServerManager.getServerWithApiKey('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('setActiveRemoteTextModel', () => {
    it('should set active server and model, and load model on provider', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('llama2'),
        isReady: jest.fn().mockResolvedValue(true),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
        getModelById: jest.fn().mockReturnValue(null),
      });

      await remoteServerManager.setActiveRemoteTextModel('server-123', 'llama2');

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith('server-123');
      expect(useRemoteServerStore.getState().setActiveRemoteTextModelId).toHaveBeenCalledWith('llama2');
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('server-123');
      expect(mockLoadModel).toHaveBeenCalledWith('llama2');
    });

    it('propagates the discovered supportsToolCalling capability into the provider', async () => {
      // Guards the inert-fix bug: the request builders gate tools on
      // provider.modelCapabilities.supportsToolCalling, so discovery MUST copy the
      // discovered value in — otherwise it stays at the provider default (true) and the
      // gate never suppresses tools for a non-tool-calling model.
      // OpenAICompatibleProvider is mocked as jest.fn() at the top of this file; the
      // code guards `provider instanceof OpenAICompatibleProvider`, so the mock provider
      // must be an instance of that mock constructor for the capability-apply branch to run.
      const { OpenAICompatibleProvider } = require('../../../src/services/providers/openAICompatibleProvider');
      const updateSpy = jest.fn();
      const realProvider = Object.assign(Object.create(OpenAICompatibleProvider.prototype), {
        loadModel: jest.fn().mockResolvedValue(undefined),
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('m'),
        isReady: jest.fn().mockResolvedValue(true),
        updateCapabilities: updateSpy,
        capabilities: { supportsToolCalling: true },
      });
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(realProvider);
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
        getModelById: jest.fn().mockReturnValue({
          id: 'm',
          capabilities: { supportsVision: false, supportsThinking: false, acceptsThinkingKwarg: false, supportsToolCalling: false },
        }),
      });

      await remoteServerManager.setActiveRemoteTextModel('server-123', 'm');

      // The discovered supportsToolCalling:false must reach the provider — without this
      // propagation the request-body gate is inert (stays at the default true).
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ supportsToolCalling: false }));
    });

    it('should handle missing provider gracefully', async () => {
      (providerRegistry.getProvider as jest.Mock).mockReturnValue(undefined);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      // Should not throw
      await expect(
        remoteServerManager.setActiveRemoteTextModel('server-123', 'llama2')
      ).resolves.not.toThrow();
    });
  });

  describe('setActiveRemoteImageModel', () => {
    it('should set active server and vision model', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('llava'),
        isReady: jest.fn().mockResolvedValue(true),
      };

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      await remoteServerManager.setActiveRemoteImageModel('server-123', 'llava');

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith('server-123');
      expect(useRemoteServerStore.getState().setActiveRemoteImageModelId).toHaveBeenCalledWith('llava');
      expect(mockLoadModel).toHaveBeenCalledWith('llava');
    });
  });

  describe('clearActiveRemoteModel', () => {
    it('should clear all remote selections and switch to local provider', () => {
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null),
      });

      remoteServerManager.clearActiveRemoteModel();

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith(null);
      expect(useRemoteServerStore.getState().setActiveRemoteTextModelId).toHaveBeenCalledWith(null);
      expect(useRemoteServerStore.getState().setActiveRemoteImageModelId).toHaveBeenCalledWith(null);
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('local');
    });
  });

  describe('detectVisionCapability', () => {
    it('should detect vision models from model name', () => {

      const visionModels = [
        'llava-v1.6-mistral-7b',
        'gpt-4-vision-preview',
        'claude-3-opus',
        'gemini-pro-vision',
        'qwen-vl-chat',
      ];

      const nonVisionModels = [
        'llama-2-7b',
        'mistral-7b-instruct',
        'codellama-34b',
        'phi-2',
      ];

      visionModels.forEach(modelId => {
        expect(detectVisionCapability(modelId)).toBe(true);
      });

      nonVisionModels.forEach(modelId => {
        expect(detectVisionCapability(modelId)).toBe(false);
      });
    });
  });

  describe('detectToolCallingCapability', () => {
    it('should detect tool-capable models from model name', () => {

      const toolCapableModels = [
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'claude-3-sonnet',
        'mistral-7b',
        'llama-3-70b',
        'qwen-72b',
      ];

      toolCapableModels.forEach(modelId => {
        expect(detectToolCallingCapability(modelId)).toBe(true);
      });
    });

    it('should return false for non-tool-capable models', () => {

      // These should NOT match the tool capability patterns
      const nonToolModels = [
        'phi-2',
        'tinyllama',
      ];

      nonToolModels.forEach(modelId => {
        expect(detectToolCallingCapability(modelId)).toBe(false);
      });
    });

    it('should detect models with tool/function keywords', () => {

      expect(detectToolCallingCapability('llama-2-70b-tool')).toBe(true);
      expect(detectToolCallingCapability('mistral-function-call')).toBe(true);
      expect(detectToolCallingCapability('firefunction-v1')).toBe(true);
      expect(detectToolCallingCapability('dbrx-instruct')).toBe(true);
      expect(detectToolCallingCapability('command-r')).toBe(true);
    });
  });

  describe('detectVisionCapability comprehensive patterns', () => {
    it('should detect all vision model patterns', () => {

      const visionModels = [
        'llava-v1.6-mistral-7b',
        'bakllava-7b',
        'moondream-1',
        'cogvlm-7b',
        'cogagent-9b',
        'fuyu-8b',
        'idefics-9b',
        'qwen-vl-chat',
        'gpt-4-vision-preview',
        'gpt-4o',
        'claude-3-opus',
        'gemini-pro-vision',
        'pixtral-8b',
        'phi-3.5-vision',
        'minicpm-v',
        'internvl-7b',
        'yi-vl-6b',
      ];

      visionModels.forEach(modelId => {
        expect(detectVisionCapability(modelId)).toBe(true);
      });
    });

    it('should return false for non-vision models', () => {

      const nonVisionModels = [
        'llama-2-7b',
        'mistral-7b-instruct',
        'codellama-34b',
        'phi-2',
        'gpt-3.5-turbo',
      ];

      nonVisionModels.forEach(modelId => {
        expect(detectVisionCapability(modelId)).toBe(false);
      });
    });
  });

  describe('getServer', () => {
    it('should return server by ID from store', () => {
      const mockServer = { id: 'server-1', name: 'Test Server' };
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(mockServer),
      });

      const result = remoteServerManager.getServer('server-1');

      expect(result).toEqual(mockServer);
    });

    it('should return null when server not found', () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(null),
      });

      const result = remoteServerManager.getServer('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getServers', () => {
    it('should return all servers from store', () => {
      const mockServers = [
        { id: 'server-1', name: 'Server 1' },
        { id: 'server-2', name: 'Server 2' },
      ];
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        servers: mockServers,
      });

      const result = remoteServerManager.getServers();

      expect(result).toEqual(mockServers);
    });
  });

  describe('getActiveServer', () => {
    it('should return active server from store', () => {
      const mockServer = { id: 'server-1', name: 'Active Server' };
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getActiveServer: jest.fn().mockReturnValue(mockServer),
      });

      const result = remoteServerManager.getActiveServer();

      expect(result).toEqual(mockServer);
    });

    it('should return null when no active server', () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getActiveServer: jest.fn().mockReturnValue(null),
      });

      const result = remoteServerManager.getActiveServer();

      expect(result).toBeNull();
    });
  });

  describe('setActiveServer', () => {
    it('should set active server and provider', () => {
      const _mockSetActiveProvider = jest.fn();
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
      });

      remoteServerManager.setActiveServer('server-1');

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith('server-1');
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('server-1');
    });

    it('should set to local when id is null', () => {
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
      });

      remoteServerManager.setActiveServer(null);

      expect(useRemoteServerStore.getState().setActiveServerId).toHaveBeenCalledWith(null);
      expect(providerRegistry.setActiveProvider).toHaveBeenCalledWith('local');
    });
  });

  describe('testConnection', () => {
    it('should return store result as-is (capabilities come from server API, not name patterns)', async () => {
      const mockModels = [
        { id: 'llava-v1.6', name: 'LLaVA', capabilities: { supportsVision: true } },
        { id: 'llama-3-70b', name: 'Llama 3', capabilities: { supportsToolCalling: false } },
      ];
      const mockTestConnection = jest.fn().mockResolvedValue({
        success: true,
        models: mockModels,
      });

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        testConnection: mockTestConnection,
      });

      const result = await remoteServerManager.testConnection('server-1');

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(2);
      // Capabilities are returned as-is from the store (server-API-derived), not overwritten
      expect(result.models?.[0].capabilities.supportsVision).toBe(true);
      expect(result.models?.[1].capabilities.supportsToolCalling).toBe(false);
    });

    it('should return result without models when test fails', async () => {
      const mockTestConnection = jest.fn().mockResolvedValue({
        success: false,
        error: 'Connection refused',
      });

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        testConnection: mockTestConnection,
      });

      const result = await remoteServerManager.testConnection('server-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.models).toBeUndefined();
    });

    it('should return result without models when none discovered', async () => {
      const mockTestConnection = jest.fn().mockResolvedValue({
        success: true,
        models: [],
      });

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        testConnection: mockTestConnection,
      });

      const result = await remoteServerManager.testConnection('server-1');

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(0);
    });
  });

  describe('testConnectionByEndpoint', () => {
    it('should delegate to store testConnectionByEndpoint', async () => {
      const mockTestConnectionByEndpoint = jest.fn().mockResolvedValue({
        success: true,
        latency: 50,
      });

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        testConnectionByEndpoint: mockTestConnectionByEndpoint,
      });

      const result = await remoteServerManager.testConnectionByEndpoint('http://localhost:11434');

      expect(mockTestConnectionByEndpoint).toHaveBeenCalledWith('http://localhost:11434', undefined);
      expect(result.success).toBe(true);
    });

    it('should pass API key to store', async () => {
      const mockTestConnectionByEndpoint = jest.fn().mockResolvedValue({
        success: true,
      });

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        testConnectionByEndpoint: mockTestConnectionByEndpoint,
      });

      await remoteServerManager.testConnectionByEndpoint('http://localhost:11434', 'api-key');

      expect(mockTestConnectionByEndpoint).toHaveBeenCalledWith('http://localhost:11434', 'api-key');
    });
  });

  describe('discoverModels', () => {
    it('should throw when server not found', async () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(null),
      });

      await expect(remoteServerManager.discoverModels('nonexistent'))
        .rejects.toThrow('Server not found');
    });

    it('should discover models from server', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };
      const mockModels = [{ id: 'model-1', name: 'Model 1' }];

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(mockServer),
        discoverModels: jest.fn().mockResolvedValue(mockModels),
      });
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      const models = await remoteServerManager.discoverModels('server-1');

      expect(models).toEqual(mockModels);
    });

    it('should pass API key when discovering models', async () => {
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };
      const mockModels = [{ id: 'model-1', name: 'Model 1' }];

      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        getServerById: jest.fn().mockReturnValue(mockServer),
        discoverModels: jest.fn().mockResolvedValue(mockModels),
      });
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'server_server-1',
        password: 'secret-key', // NOSONAR - test mock value, not a real credential
      });

      const models = await remoteServerManager.discoverModels('server-1');

      expect(models).toEqual(mockModels);
    });
  });

  describe('setActiveRemoteTextModel - provider creation', () => {
    it('should create provider when it does not exist', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        getLoadedModelId: jest.fn().mockReturnValue('llama2'),
        isReady: jest.fn().mockResolvedValue(true),
      };
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };

      (providerRegistry.getProvider as jest.Mock)
        .mockReturnValueOnce(null) // First call returns null
        .mockReturnValueOnce(mockProvider); // Second call returns provider after creation
      (providerRegistry.registerProvider as jest.Mock).mockReturnValue(undefined);
      (providerRegistry.setActiveProvider as jest.Mock).mockReturnValue(true);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(mockServer),
        getModelById: jest.fn().mockReturnValue(null),
      });
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      await remoteServerManager.setActiveRemoteTextModel('server-1', 'llama2');

      expect(providerRegistry.registerProvider).toHaveBeenCalled();
      expect(mockLoadModel).toHaveBeenCalledWith('llama2');
    });
  });

  describe('setActiveRemoteImageModel - provider creation', () => {
    it('should create provider when it does not exist', async () => {
      const mockLoadModel = jest.fn().mockResolvedValue(undefined);
      const mockProvider = {
        loadModel: mockLoadModel,
        unloadModel: jest.fn(),
        isModelLoaded: jest.fn().mockReturnValue(true),
        isReady: jest.fn().mockResolvedValue(true),
      };
      const mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };

      (providerRegistry.getProvider as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockProvider);
      (providerRegistry.registerProvider as jest.Mock).mockReturnValue(undefined);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(mockServer),
      });
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(null);

      await remoteServerManager.setActiveRemoteImageModel('server-1', 'llava');

      expect(providerRegistry.registerProvider).toHaveBeenCalled();
      expect(mockLoadModel).toHaveBeenCalledWith('llava');
    });

    it('should warn when provider cannot be created', async () => {
      const _mockServer = { id: 'server-1', name: 'Test', endpoint: 'http://localhost:11434' };
      const _mockLogger = { warn: jest.fn() };
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        setActiveServerId: jest.fn(),
        setActiveRemoteTextModelId: jest.fn(),
        setActiveRemoteImageModelId: jest.fn(),
        getServerById: jest.fn().mockReturnValue(null), // No server found
      });

      await remoteServerManager.setActiveRemoteImageModel('server-1', 'llava');

      // No provider created because server not found
      expect(providerRegistry.registerProvider).not.toHaveBeenCalled();
    });
  });
});