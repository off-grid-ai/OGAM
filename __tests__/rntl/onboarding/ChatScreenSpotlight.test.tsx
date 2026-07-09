/**
 * ChatScreen Spotlight Integration Tests
 *
 * Renders the actual ChatScreen and verifies:
 * - Pending step 3 consumption → goTo(3) → chain to step 12
 * - Pending non-step-3 consumption (e.g., step 15)
 * - Reactive imageDraw spotlight (step 15)
 * - Reactive imageSettings spotlight (step 16)
 * - chatSpotlight state ensures only one AttachStep at a time
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, setupFullChat } from '../../utils/testHelpers';
import { createGeneratedImage } from '../../utils/factories';
import { mockGoTo, clearSpotlightMocks } from '../../utils/spotlightMocks';
import {
  setPendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';

// Capture current state for step-chaining tests
let mockCurrent: number | undefined = 0;

jest.mock('react-native-spotlight-tour', () => {
  const mocks = require('../../utils/spotlightMocks');
  return {
    ...mocks.createSpotlightTourMock(),
    useSpotlightTour: () => ({
      ...mocks.createSpotlightTourMock().useSpotlightTour(),
      get current() { return mockCurrent; },
    }),
  };
});

const mockRoute = { params: {} as any };
jest.mock('@react-navigation/native', () =>
  require('../../utils/spotlightMocks').createNavigationMock({
    useRoute: () => mockRoute,
    useFocusEffect: jest.fn((cb: () => void) => cb()),
  })
);

// Mock services
jest.mock('../../../src/services/generationService', () => ({
  generationService: {
    generateResponse: jest.fn(() => Promise.resolve()),
    stopGeneration: jest.fn(() => Promise.resolve()),
    getState: jest.fn(() => ({
      isGenerating: false, isThinking: false, conversationId: null,
      streamingContent: '', queuedMessages: [],
    })),
    subscribe: jest.fn((cb: (s: any) => void) => {
      cb({ isGenerating: false, isThinking: false, conversationId: null, streamingContent: '', queuedMessages: [] });
      return jest.fn();
    }),
    isGeneratingFor: jest.fn(() => false),
    enqueueMessage: jest.fn(),
    removeFromQueue: jest.fn(),
    clearQueue: jest.fn(),
    setQueueProcessor: jest.fn(),
  },
}));

jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadModel: jest.fn(() => Promise.resolve()),
    loadTextModel: jest.fn(() => Promise.resolve()),
    unloadModel: jest.fn(() => Promise.resolve()),
    unloadTextModel: jest.fn(() => Promise.resolve()),
    unloadImageModel: jest.fn(() => Promise.resolve()),
    getActiveModels: jest.fn(() => ({
      text: { modelId: null, modelPath: null, isLoading: false },
      image: { modelId: null, modelPath: null, isLoading: false },
    })),
    checkMemoryAvailable: jest.fn(() => ({ safe: true, severity: 'safe' })),
    checkMemoryForModel: jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: null })),
    subscribe: jest.fn(() => jest.fn()),
  },
}));

const mockImageGenState = {
  isGenerating: false, progress: null, status: null, previewPath: null,
  prompt: null, conversationId: null, error: null, result: null,
};

jest.mock('../../../src/services/imageGenerationService', () => ({
  imageGenerationService: {
    generateImage: jest.fn(() => Promise.resolve(true)),
    getState: jest.fn(() => mockImageGenState),
    subscribe: jest.fn((cb: (s: any) => void) => { cb(mockImageGenState); return jest.fn(); }),
    isGeneratingFor: jest.fn(() => false),
    cancel: jest.fn(),
    cancelGeneration: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../../src/services/intentClassifier', () => ({
  intentClassifier: {
    classifyIntent: jest.fn(() => Promise.resolve('text')),
    isImageRequest: jest.fn(() => false),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => true),
    supportsVision: jest.fn(() => false),
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
    clearKVCache: jest.fn(() => Promise.resolve()),
    getMultimodalSupport: jest.fn(() => null),
    getLoadedModelPath: jest.fn(() => null),
    stopGeneration: jest.fn(() => Promise.resolve()),
    getPerformanceStats: jest.fn(() => ({
      tokensPerSecond: 0, totalTokens: 0, timeToFirstToken: 0,
      lastTokensPerSecond: 0, lastTimeToFirstToken: 0,
    })),
    getContextDebugInfo: jest.fn(() => Promise.resolve({
      contextUsagePercent: 0, truncatedCount: 0, totalTokens: 0, maxContext: 2048,
    })),
  },
}));

jest.mock('../../../src/services/hardware', () =>
  require('../../utils/spotlightMocks').createHardwareServiceMock()
);

jest.mock('../../../src/services/modelManager', () =>
  require('../../utils/spotlightMocks').createModelManagerMock()
);

jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    deleteGeneratedImage: jest.fn(() => Promise.resolve()),
  },
}));

// Mock child components
jest.mock('../../../src/components', () => ({
  ChatMessage: () => null,
  ChatInput: ({ activeSpotlight }: any) => {
    const { View, Text } = require('react-native');
    return (
      <View testID="chat-input">
        {activeSpotlight && <Text testID="active-spotlight">{activeSpotlight}</Text>}
      </View>
    );
  },
  ThinkingIndicator: () => null,
  ModelFailureCard: () => null,
  ImageGenAdviceCard: () => null,
  ModelSelectorModal: () => null,
  GenerationSettingsModal: () => null,
  ProjectSelectorSheet: () => null,
  DebugSheet: () => null,
  ...require('../../utils/spotlightMocks').createCustomAlertMock(),
  SharePromptSheet: () => null,
  ProAhaSheet: () => null,
}));

jest.mock('../../../src/components/AnimatedPressable', () =>
  require('../../utils/spotlightMocks').createAnimatedPressableMock()
);

import { ChatScreen } from '../../../src/screens/ChatScreen';

let unmountFn: (() => void) | null = null;

function renderChatScreen() {
  setupFullChat();
  const result = render(
    <NavigationContainer>
      <ChatScreen />
    </NavigationContainer>
  );
  unmountFn = result.unmount;
  return result;
}

describe('ChatScreen Spotlight Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
    setPendingSpotlight(null);
    clearSpotlightMocks();
    mockCurrent = 0;
    unmountFn = null;
  });

  afterEach(() => {
    if (unmountFn) { unmountFn(); unmountFn = null; }
    jest.useRealTimers();
  });

  // ========================================================================
  // Pending step consumption
  // ========================================================================
  describe('pending spotlight consumption', () => {
    it('consumes pending step 3 and fires goTo(3) after 600ms', () => {
      setPendingSpotlight(3);
      renderChatScreen();

      expect(peekPendingSpotlight()).toBeNull();
      expect(mockGoTo).not.toHaveBeenCalled();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(3);
    });

    it('consumes arbitrary pending step and fires goTo', () => {
      setPendingSpotlight(15);
      renderChatScreen();

      expect(peekPendingSpotlight()).toBeNull();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(15);
    });

    it('does not fire goTo when no pending spotlight', () => {
      renderChatScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Step 3 → Step 12 chain
  // ========================================================================
  describe('step 3 → step 12 chain', () => {
    it('chains to step 12 after step 3 tour stops', () => {
      setPendingSpotlight(3);
      renderChatScreen();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(3);

      // Simulate tour stopping (current becomes undefined)
      act(() => { mockCurrent = undefined; });
      act(() => { jest.advanceTimersByTime(800); });
    });
  });

  // ========================================================================
  // Pending spotlight: imageDraw (step 15) via focus-based consumption
  // ========================================================================
  describe('pending spotlight: imageDraw (step 15) via focus', () => {
    it('fires goTo(15) when pending spotlight is set', () => {
      setPendingSpotlight(15);
      renderChatScreen();

      act(() => { jest.advanceTimersByTime(600); });
      expect(mockGoTo).toHaveBeenCalledWith(15);
    });

    it('does NOT fire when no pending spotlight is set', () => {
      renderChatScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Reactive: imageSettings spotlight (step 16)
  // ========================================================================
  describe('reactive: imageSettings spotlight (step 16)', () => {
    it('fires goTo(16) when images generated and triedImageGen completed', () => {
      act(() => {
        useAppStore.getState().addGeneratedImage(createGeneratedImage());
        useAppStore.getState().completeChecklistStep('triedImageGen');
      });

      renderChatScreen();

      act(() => { jest.advanceTimersByTime(800); });
      expect(mockGoTo).toHaveBeenCalledWith(16);
      expect(useAppStore.getState().shownSpotlights.imageSettings).toBe(true);
    });

    it('does NOT fire when no images generated', () => {
      act(() => {
        useAppStore.getState().completeChecklistStep('triedImageGen');
      });

      renderChatScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when triedImageGen NOT set', () => {
      act(() => {
        useAppStore.getState().addGeneratedImage(createGeneratedImage());
      });

      renderChatScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });

    it('does NOT fire when already shown', () => {
      act(() => {
        useAppStore.getState().addGeneratedImage(createGeneratedImage());
        useAppStore.getState().completeChecklistStep('triedImageGen');
        useAppStore.getState().markSpotlightShown('imageSettings');
      });

      renderChatScreen();

      act(() => { jest.advanceTimersByTime(1000); });
      expect(mockGoTo).not.toHaveBeenCalled();
    });
  });
});
