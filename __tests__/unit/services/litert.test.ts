/**
 * Unit tests for litert.ts
 * Targets the state-machine branches that don't require native hardware.
 */

// Mock NativeModules BEFORE importing the service
const mockLiteRTModule = {
  loadModel: jest.fn(),
  resetConversation: jest.fn(),
  sendMessage: jest.fn(),
  sendMessageWithImages: jest.fn(),
  sendMessageWithAudio: jest.fn(),
  stopGeneration: jest.fn(),
  unloadModel: jest.fn(),
  getMemoryInfo: jest.fn(),
};

const mockAddListener = jest.fn(() => ({ remove: jest.fn() }));
const mockEmitter = { addListener: mockAddListener };

jest.mock('react-native', () => ({
  NativeModules: { LiteRTModule: mockLiteRTModule },
  NativeEventEmitter: jest.fn(() => mockEmitter),
  Platform: {
    OS: 'android',
    select: (spec: Record<string, any>) => spec.android ?? spec.default ?? null,
  },
}));

jest.mock('../../../src/utils/logger', () => {
  const log = jest.fn();
  return { __esModule: true, default: { log, error: log, warn: log } };
});

// Import after mocks are set up
import { liteRTService } from '../../../src/services/litert';

describe('LiteRTService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state to unloaded
    (liteRTService as any).loaded = false;
    (liteRTService as any).activeBackend = null;
    (liteRTService as any).activeConversationId = null;
    (liteRTService as any).activeSystemPrompt = null;
    (liteRTService as any).subscriptions = [];
    (liteRTService as any).currentCallbacks = null;
    // Ensure emitter is available for tests that need it
    (liteRTService as any).emitter = mockEmitter;
    // Make isAvailable return true by default so state-machine methods run
    jest.spyOn(liteRTService, 'isAvailable').mockReturnValue(true);
  });

  describe('isModelLoaded', () => {
    it('returns false when not loaded', () => {
      expect(liteRTService.isModelLoaded()).toBe(false);
    });

    it('returns true when loaded flag is set', () => {
      (liteRTService as any).loaded = true;
      expect(liteRTService.isModelLoaded()).toBe(true);
    });
  });

  describe('getActiveBackend', () => {
    it('returns null when no model loaded', () => {
      expect(liteRTService.getActiveBackend()).toBeNull();
    });

    it('returns backend when set', () => {
      (liteRTService as any).activeBackend = 'npu';
      expect(liteRTService.getActiveBackend()).toBe('npu');
    });
  });

  describe('isNPU', () => {
    it('returns false when backend is cpu', () => {
      (liteRTService as any).activeBackend = 'cpu';
      expect(liteRTService.isNPU()).toBe(false);
    });

    it('returns true when backend is npu', () => {
      (liteRTService as any).activeBackend = 'npu';
      expect(liteRTService.isNPU()).toBe(true);
    });
  });

  describe('loadModel', () => {
    it('calls onError when model not loaded (sendMessage guard)', async () => {
      // loadModel uses module-level LiteRTModule const captured at import — hard to mock via NativeModules.
      // Instead verify the isAvailable guard indirectly via sendMessage which rejects when not loaded.
      (liteRTService as any).loaded = false;
      const onError = jest.fn();
      await liteRTService.sendMessage('test', { onToken: jest.fn(), onReasoning: jest.fn(), onComplete: jest.fn(), onError });
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('calls onError immediately when model is not loaded', async () => {
      const onError = jest.fn();
      const callbacks = { onToken: jest.fn(), onReasoning: jest.fn(), onComplete: jest.fn(), onError };
      await liteRTService.sendMessage('hello', callbacks);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(mockLiteRTModule.sendMessage).not.toHaveBeenCalled();
    });

    it('uses sendMessageWithImages when multiple image URIs are provided', async () => {
      const isolatedLiteRTModule = {
        loadModel: jest.fn(),
        resetConversation: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        sendMessageWithImages: jest.fn().mockResolvedValue(undefined),
        stopGeneration: jest.fn(),
        unloadModel: jest.fn(),
        getMemoryInfo: jest.fn(),
      };
      const isolatedEmitter = { addListener: jest.fn(() => ({ remove: jest.fn() })) };

      jest.resetModules();
      jest.doMock('react-native', () => ({
        NativeModules: { LiteRTModule: isolatedLiteRTModule },
        NativeEventEmitter: jest.fn(() => isolatedEmitter),
        Platform: {
          OS: 'android',
          select: (spec: Record<string, any>) => spec.android ?? spec.default ?? null,
        },
      }));
      jest.doMock('../../../src/utils/logger', () => {
        const log = jest.fn();
        return { __esModule: true, default: { log, error: log, warn: log } };
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { liteRTService: isolatedService } = require('../../../src/services/litert');
      (isolatedService as any).loaded = true;

      const callbacks = {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };

      await isolatedService.sendMessage('hello', callbacks, { imageUris: ['file:///one.png', 'file:///two.png'] });

      expect(callbacks.onError).not.toHaveBeenCalled();
      expect(isolatedLiteRTModule.sendMessageWithImages).toHaveBeenCalledWith('hello', ['file:///one.png', 'file:///two.png']);
      expect(isolatedLiteRTModule.sendMessage).not.toHaveBeenCalled();
    });

    it('uses sendMessageWithAudio (not images/text) when audio URIs are provided', async () => {
      const isolatedLiteRTModule = {
        loadModel: jest.fn(),
        resetConversation: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        sendMessageWithImages: jest.fn().mockResolvedValue(undefined),
        sendMessageWithAudio: jest.fn().mockResolvedValue(undefined),
        stopGeneration: jest.fn(),
        unloadModel: jest.fn(),
        getMemoryInfo: jest.fn(),
      };
      const isolatedEmitter = { addListener: jest.fn(() => ({ remove: jest.fn() })) };

      jest.resetModules();
      jest.doMock('react-native', () => ({
        NativeModules: { LiteRTModule: isolatedLiteRTModule },
        NativeEventEmitter: jest.fn(() => isolatedEmitter),
        Platform: {
          OS: 'android',
          select: (spec: Record<string, any>) => spec.android ?? spec.default ?? null,
        },
      }));
      jest.doMock('../../../src/utils/logger', () => {
        const log = jest.fn();
        return { __esModule: true, default: { log, error: log, warn: log } };
      });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { liteRTService: isolatedService } = require('../../../src/services/litert');
      (isolatedService as any).loaded = true;

      const callbacks = {
        onToken: jest.fn(),
        onReasoning: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };

      await isolatedService.sendMessage('hi', callbacks, { audioUris: ['file:///clip.wav'] });

      expect(callbacks.onError).not.toHaveBeenCalled();
      expect(isolatedLiteRTModule.sendMessageWithAudio).toHaveBeenCalledWith('hi', ['file:///clip.wav']);
      expect(isolatedLiteRTModule.sendMessageWithImages).not.toHaveBeenCalled();
      expect(isolatedLiteRTModule.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('supportsAudio', () => {
    it('returns false when no model is loaded', () => {
      (liteRTService as any).loaded = false;
      (liteRTService as any).modelSupportsAudio = true;
      expect(liteRTService.supportsAudio()).toBe(false);
    });

    it('returns false when the loaded model has no audio capability', () => {
      (liteRTService as any).loaded = true;
      (liteRTService as any).modelSupportsAudio = false;
      expect(liteRTService.supportsAudio()).toBe(false);
    });

    it('returns true only when loaded and the model supports audio', () => {
      (liteRTService as any).loaded = true;
      (liteRTService as any).modelSupportsAudio = true;
      expect(liteRTService.supportsAudio()).toBe(true);
    });
  });

  describe('prepareConversation', () => {
    it('skips reset when conversationId and systemPrompt are unchanged', async () => {
      (liteRTService as any).loaded = true;
      (liteRTService as any).activeConversationId = 'conv-1';
      (liteRTService as any).activeSystemPrompt = 'You are helpful.';
      (liteRTService as any).activeToolsJson = '';
      mockLiteRTModule.resetConversation.mockResolvedValue(undefined);

      await liteRTService.prepareConversation('conv-1', 'You are helpful.');

      expect(mockLiteRTModule.resetConversation).not.toHaveBeenCalled();
    });

    it('calls resetConversation when systemPrompt changes', async () => {
      // Spy on resetConversation directly since LiteRTModule const is captured at import
      const resetSpy = jest.spyOn(liteRTService as any, 'resetConversation').mockResolvedValue(undefined);
      (liteRTService as any).loaded = true;
      (liteRTService as any).activeConversationId = 'conv-1';
      (liteRTService as any).activeSystemPrompt = 'Old prompt';

      await liteRTService.prepareConversation('conv-1', 'New prompt');

      expect(resetSpy).toHaveBeenCalledWith('New prompt', { samplerConfig: undefined, tools: undefined, history: undefined });
      expect((liteRTService as any).activeConversationId).toBe('conv-1');
      resetSpy.mockRestore();
    });
  });

  describe('stopGeneration', () => {
    it('does not throw when called (even with no active generation)', async () => {
      (liteRTService as any).activeConversationId = 'conv-1';
      mockLiteRTModule.stopGeneration.mockResolvedValue(undefined);

      await expect(liteRTService.stopGeneration()).resolves.not.toThrow();
    });

    it('swallows errors from native stopGeneration', async () => {
      mockLiteRTModule.stopGeneration.mockRejectedValue(new Error('native error'));
      await expect(liteRTService.stopGeneration()).resolves.not.toThrow();
    });
  });

  describe('unloadModel', () => {
    it('sets loaded=false and clears backend in finally block', async () => {
      (liteRTService as any).loaded = true;
      (liteRTService as any).activeBackend = 'gpu';
      mockLiteRTModule.unloadModel.mockResolvedValue(undefined);

      await liteRTService.unloadModel();

      expect(liteRTService.isModelLoaded()).toBe(false);
      expect(liteRTService.getActiveBackend()).toBeNull();
    });

    it('still clears state even when native unloadModel throws', async () => {
      (liteRTService as any).loaded = true;
      (liteRTService as any).activeBackend = 'npu';
      mockLiteRTModule.unloadModel.mockRejectedValue(new Error('unload failed'));

      await liteRTService.unloadModel();

      expect(liteRTService.isModelLoaded()).toBe(false);
      expect(liteRTService.getActiveBackend()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // loadModel — unavailable guard (does not require native LiteRTModule)
  // -------------------------------------------------------------------------

  describe('loadModel — unavailability guard', () => {
    it('throws when native module unavailable', async () => {
      jest.spyOn(liteRTService, 'isAvailable').mockReturnValue(false);
      await expect(liteRTService.loadModel('/model.bin', 'gpu')).rejects.toThrow('LiteRT is not available');
    });
  });

  // -------------------------------------------------------------------------
  // resetConversation — guard + state (via spied resetConversation)
  // -------------------------------------------------------------------------

  describe('resetConversation', () => {
    it('throws when not loaded', async () => {
      (liteRTService as any).loaded = false;
      jest.spyOn(liteRTService, 'isAvailable').mockReturnValue(true);
      await expect(liteRTService.resetConversation('sys')).rejects.toThrow('No LiteRT model loaded');
    });

    it('throws when native module unavailable', async () => {
      (liteRTService as any).loaded = true;
      jest.spyOn(liteRTService, 'isAvailable').mockReturnValue(false);
      await expect(liteRTService.resetConversation('sys')).rejects.toThrow('No LiteRT model loaded');
    });
  });
});
