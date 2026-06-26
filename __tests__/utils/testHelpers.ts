/**
 * Test Helpers
 *
 * Utility functions for testing Off Grid components and services.
 */

import { act } from '@testing-library/react-native';
import { useAppStore } from '../../src/stores/appStore';
import { useChatStore } from '../../src/stores/chatStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useProjectStore } from '../../src/stores/projectStore';
import { useWhisperStore } from '../../src/stores/whisperStore';
import { useRemoteServerStore } from '../../src/stores/remoteServerStore';
import {
  createConversation,
  createMessage,
  createDownloadedModel,
  createDeviceInfo,
  createONNXImageModel,
  createGeneratedImage,
  resetIdCounter,
  ConversationFactoryOptions,
  DownloadedModelFactoryOptions,
} from './factories';

// ============================================================================
// Store Reset Utilities
// ============================================================================

/**
 * Resets all Zustand stores to their initial state.
 * Call this in beforeEach() to ensure clean state between tests.
 */
export const resetStores = (): void => {
  // Reset the ID counter for consistent test data
  resetIdCounter();

  // Reset app store
  useAppStore.setState({
    hasCompletedOnboarding: false,
    deviceInfo: null,
    modelRecommendation: null,
    downloadedModels: [],
    activeModelId: null,
    lastTextModelId: null,
    isLoadingModel: false,
    settings: {
      systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
      temperature: 0.7,
      maxTokens: 1024,
      topP: 0.9,
      repeatPenalty: 1.1,
      contextLength: 4096,
      nThreads: 0,
      nBatch: 512,
      imageGenerationMode: 'auto',
      autoDetectMethod: 'pattern',
      classifierModelId: null,
      imageSteps: 8,
      imageGuidanceScale: 7.5,
      imageThreads: 4,
      imageWidth: 512,
      imageHeight: 512,
      imageUseOpenCL: true,
      enableGpu: true,
      inferenceBackend: 'cpu' as const,
      gpuLayers: 99,
      flashAttn: false,
      cacheType: 'q8_0',
      showGenerationDetails: false,
      enhanceImagePrompts: false,
      enabledTools: ['calculator', 'get_current_datetime'],
      thinkingEnabled: true,
      liteRTBackend: 'gpu' as const,
      liteRTTemperature: 0.7,
      liteRTTopP: 0.9,
      liteRTMaxTokens: 4096,
    },
    downloadedImageModels: [],
    activeImageModelId: null,
    isGeneratingImage: false,
    imageGenerationProgress: null,
    imageGenerationStatus: null,
    imagePreviewPath: null,
    generatedImages: [],
    shownSpotlights: {},
    textGenerationCount: 0,
    imageGenerationCount: 0,
    hasEngagedSharePrompt: false,
    loadedSettings: null,
    onboardingChecklist: {
      downloadedModel: false,
      loadedModel: false,
      sentMessage: false,
      triedImageGen: false,
      exploredSettings: false,
      createdProject: false,
    },
    checklistDismissed: false,
  });

  // Reset chat store
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    streamingMessage: '',
    streamingForConversationId: null,
    isStreaming: false,
    isThinking: false,
  });

  // Reset auth store
  useAuthStore.setState({
    isEnabled: false,
    isLocked: true,
    failedAttempts: 0,
    lockoutUntil: null,
    lastBackgroundTime: null,
  });

  // Reset project store
  useProjectStore.setState({
    projects: [],
  });

  // Reset whisper store
  useWhisperStore.setState({
    downloadedModelId: null,
    isDownloading: false,
    downloadProgress: 0,
    isModelLoading: false,
    isModelLoaded: false,
    error: null,
  });

  // Reset remote server store
  useRemoteServerStore.setState({
    servers: [],
    activeServerId: null,
    discoveredModels: {},
    serverHealth: {},
    isLoading: false,
    testingServerId: null,
    discoveringServerId: null,
    activeRemoteTextModelId: null,
    activeRemoteImageModelId: null,
  });
};

// ============================================================================
// Store Setup Utilities
// ============================================================================

/**
 * Sets up the app store with a downloaded model and makes it active.
 */
export const setupWithActiveModel = (modelOptions: DownloadedModelFactoryOptions = {}): string => {
  const model = createDownloadedModel(modelOptions);
  useAppStore.setState({
    downloadedModels: [model],
    activeModelId: model.id,
    hasCompletedOnboarding: true,
    deviceInfo: createDeviceInfo(),
  });
  return model.id;
};

/**
 * Sets up the chat store with a conversation.
 */
export const setupWithConversation = (conversationOptions: ConversationFactoryOptions = {}): string => {
  const conversation = createConversation(conversationOptions);
  useChatStore.setState({
    conversations: [conversation],
    activeConversationId: conversation.id,
  });
  return conversation.id;
};

/**
 * Sets up both stores with an active model and conversation.
 */
export const setupFullChat = (
  modelOptions: DownloadedModelFactoryOptions = {},
  conversationOptions: ConversationFactoryOptions = {}
): { modelId: string; conversationId: string } => {
  const modelId = setupWithActiveModel(modelOptions);
  const conversationId = setupWithConversation({
    ...conversationOptions,
    modelId,
  });
  return { modelId, conversationId };
};

/**
 * Sets up the app store with an image model.
 */
export const setupWithImageModel = (): string => {
  const imageModel = createONNXImageModel();
  useAppStore.setState({
    downloadedImageModels: [imageModel],
    activeImageModelId: imageModel.id,
  });
  return imageModel.id;
};

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Waits for all pending promises and state updates to complete.
 * Use this after triggering async operations in tests.
 */
export const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  });
};

/**
 * Waits for a specified amount of time.
 * Use sparingly - prefer flushPromises when possible.
 */
export const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(() => resolve(), ms));
  });
};

/**
 * Waits for a condition to be true, with timeout.
 */
export const waitFor = async (
  condition: () => boolean,
  { timeout = 1000, interval = 50 } = {}
): Promise<void> => {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('waitFor timeout exceeded');
    }
    await wait(interval);
  }
};

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Gets the current state of the app store.
 */
export const getAppState = () => useAppStore.getState();

/**
 * Gets the current state of the chat store.
 */
export const getChatState = () => useChatStore.getState();

/**
 * Gets the current state of the auth store.
 */
export const getAuthState = () => useAuthStore.getState();

/**
 * Gets the active conversation from the chat store.
 */
export const getActiveConversation = () => {
  const state = useChatStore.getState();
  return state.conversations.find(c => c.id === state.activeConversationId) ?? null;
};

/**
 * Gets messages from the active conversation.
 */
export const getActiveMessages = () => {
  const conversation = getActiveConversation();
  return conversation?.messages ?? [];
};

// ============================================================================
// Mock Utilities
// ============================================================================

/**
 * Creates a mock function that resolves after a delay.
 */
export const createDelayedMock = <T>(value: T, delayMs = 100) =>
  jest.fn(() => new Promise<T>(resolve => setTimeout(() => resolve(value), delayMs)));

/**
 * Creates a mock function that rejects after a delay.
 */
export const createDelayedRejectMock = (error: Error, delayMs = 100) =>
  jest.fn(() => new Promise((_, reject) => setTimeout(() => reject(error), delayMs)));

/**
 * Creates a mock streaming callback that calls onToken multiple times.
 */
export const createStreamingMock = (tokens: string[], delayBetweenTokens = 10) => {
  return jest.fn(async (
    _messages: unknown,
    onToken: (token: string) => void,
    onComplete: () => void,
    _onError: (error: Error) => void,
    _onThinking?: () => void
  ) => {
    for (const token of tokens) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), delayBetweenTokens));
      onToken(token);
    }
    onComplete();
  });
};

// ============================================================================
// Mock Context Factories
// ============================================================================

/**
 * Creates a mock LlamaContext matching the llama.rn initLlama return shape.
 */
export const createMockLlamaContext = (overrides: Record<string, any> = {}) => ({
  id: 'test-context-id',
  gpu: false,
  reasonNoGPU: 'Test environment',
  model: {
    nParams: 1000000,
    chatTemplates: {
      llamaChat: false,
      jinja: {
        default: false,
        defaultCaps: {
          tools: false,
          toolCalls: false,
          systemRole: true,
          parallelToolCalls: false,
        },
        toolUse: false,
      },
    },
  },
  isJinjaSupported: jest.fn(() => false),
  release: jest.fn(() => Promise.resolve()),
  completion: jest.fn((..._args: any[]) => Promise.resolve({
    text: 'Test completion response',
    tokens_predicted: 10,
    tokens_evaluated: 5,
    timings: { predicted_per_token_ms: 50, predicted_per_second: 20 },
  })),
  stopCompletion: jest.fn(() => Promise.resolve()),
  tokenize: jest.fn((text: string) => Promise.resolve({ tokens: new Array(Math.ceil(text.length / 4)) })),
  initMultimodal: jest.fn(() => Promise.resolve(true)),
  getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: false, audio: false })),
  clearCache: jest.fn(() => Promise.resolve()),
  transcribe: jest.fn(() => ({
    promise: Promise.resolve({ result: 'transcribed text' }),
  })),
  ...overrides,
});

/**
 * Creates a mock WhisperContext matching the whisper.rn initWhisper return shape.
 */
export const createMockWhisperContext = (overrides: Record<string, any> = {}) => ({
  id: 'test-whisper-id',
  release: jest.fn(() => Promise.resolve()),
  transcribeRealtime: jest.fn(() => Promise.resolve({
    stop: jest.fn(),
    subscribe: jest.fn(),
  })),
  transcribe: jest.fn((_filePath: string, _opts: any) => ({
    promise: Promise.resolve({ result: 'transcribed text' }),
  })),
  ...overrides,
});

// ============================================================================
// Subscription Testing
// ============================================================================

/**
 * Collects all values emitted by a subscription during a test.
 */
export const collectSubscriptionValues = <T>(
  subscribe: (listener: (value: T) => void) => () => void
): { values: T[]; unsubscribe: () => void } => {
  const values: T[] = [];
  const unsubscribe = subscribe(value => values.push(value));
  return { values, unsubscribe };
};

// ============================================================================
// Store Action Wrappers
// ============================================================================

/**
 * Adds a message to a conversation and returns the message.
 */
export const addMessageToConversation = (
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
) => {
  const { addMessage } = useChatStore.getState();
  return addMessage(conversationId, { role, content });
};

/**
 * Simulates a complete generation flow.
 */
export const simulateGeneration = async (
  conversationId: string,
  responseContent: string
): Promise<void> => {
  const chatStore = useChatStore.getState();

  // Start streaming
  chatStore.startStreaming(conversationId);

  // Simulate token streaming
  const tokens = responseContent.split(' ');
  for (const token of tokens) {
    await flushPromises();
    chatStore.appendToStreamingMessage(`${token} `);
  }

  // Finalize
  chatStore.finalizeStreamingMessage(conversationId, 1000);
};

// ============================================================================
// Test Data Bulk Creation
// ============================================================================

/**
 * Creates multiple conversations with messages for testing lists.
 */
export const createMultipleConversations = (count: number): string[] => {
  const ids: string[] = [];
  const conversations = [];

  for (let i = 0; i < count; i++) {
    const conv = createConversation({
      title: `Conversation ${i + 1}`,
      messages: [
        createMessage({ role: 'user', content: `User message in conv ${i + 1}` }),
        createMessage({ role: 'assistant', content: `Assistant response in conv ${i + 1}` }),
      ],
    });
    ids.push(conv.id);
    conversations.push(conv);
  }

  useChatStore.setState({ conversations });
  return ids;
};

/**
 * Creates multiple downloaded models for testing.
 */
export const createMultipleModels = (count: number): string[] => {
  const ids: string[] = [];
  const models = [];

  for (let i = 0; i < count; i++) {
    const model = createDownloadedModel({
      name: `Model ${i + 1}`,
      quantization: ['Q4_K_M', 'Q5_K_M', 'Q8_0'][i % 3],
    });
    ids.push(model.id);
    models.push(model);
  }

  useAppStore.setState({ downloadedModels: models });
  return ids;
};

/**
 * Creates generated images in the gallery.
 */
export const createGalleryImages = (count: number, conversationId?: string): string[] => {
  const ids: string[] = [];
  const images = [];

  for (let i = 0; i < count; i++) {
    const image = createGeneratedImage({
      prompt: `Test prompt ${i + 1}`,
      conversationId,
    });
    ids.push(image.id);
    images.push(image);
  }

  useAppStore.setState({ generatedImages: images });
  return ids;
};

// ============================================================================
// Store-Specific Reset Utilities
// ============================================================================

/**
 * Resets download store to initial state.
 */
export const resetDownloadStore = (): void => {
  const useDownloadStore = require('../../src/stores/downloadStore').useDownloadStore;
  useDownloadStore.setState({
    downloads: {},
    downloadIdIndex: {},
  });
};

/**
 * Resets remote server store to initial state.
 */
export const resetRemoteServerStore = (): void => {
  useRemoteServerStore.setState({
    servers: [],
    activeServerId: null,
    discoveredModels: {},
    serverHealth: {},
    isLoading: false,
    testingServerId: null,
    discoveringServerId: null,
    activeRemoteTextModelId: null,
    activeRemoteImageModelId: null,
  });
};

/**
 * Resets whisper store to initial state.
 */
export const resetWhisperStore = (): void => {
  useWhisperStore.setState({
    downloadedModelId: null,
    presentModelIds: [],
    isDownloading: false,
    downloadProgress: 0,
    isModelLoading: false,
    isModelLoaded: false,
    error: null,
  });
};

/**
 * Resets project store to initial state.
 */
export const resetProjectStore = (): void => {
  useProjectStore.setState({
    projects: [],
  });
};

/**
 * Resets auth store to initial state.
 */
export const resetAuthStore = (): void => {
  useAuthStore.setState({
    isEnabled: false,
    isLocked: true,
    failedAttempts: 0,
    lockoutUntil: null,
    lastBackgroundTime: null,
  });
};

// ============================================================================
// Act() Wrapper Utilities
// ============================================================================

/**
 * Wraps a synchronous function call in act() for store updates.
 */
export const actStoreUpdate = (fn: () => void): void => {
  act(() => {
    fn();
  });
};

/**
 * Wraps an async function call in act() for store updates.
 */
export const actAsyncStoreUpdate = async (fn: () => Promise<void>): Promise<void> => {
  await act(async () => {
    await fn();
  });
};
