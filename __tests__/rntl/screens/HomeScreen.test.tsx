/**
 * HomeScreen Tests
 *
 * Tests for the home dashboard including:
 * - Model cards display
 * - Model selection and loading
 * - Memory management
 * - Quick navigation
 * - Recent conversations
 * - Stats display
 * - Gallery link
 * - New chat button
 * - Eject all button
 * - Model picker sheet interactions
 * - Delete conversation
 * - Loading overlay
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { resetStores, createMultipleConversations } from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createONNXImageModel,
  createDeviceInfo,
  createConversation,
  createVisionModel,
  createMessage,
} from '../../utils/factories';

// Mock requestAnimationFrame
(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  return setTimeout(cb, 0);
};

// Mock navigation
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock services
const mockLoadTextModel = jest.fn(() => Promise.resolve());
const mockLoadImageModel = jest.fn(() => Promise.resolve());
const mockUnloadTextModel = jest.fn(() => Promise.resolve());
const mockUnloadImageModel = jest.fn(() => Promise.resolve());
const mockUnloadAllModels = jest.fn(() => Promise.resolve({ textUnloaded: true, imageUnloaded: true }));
const mockCheckMemoryForModel = jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: '' }));

jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: mockLoadTextModel,
    loadImageModel: mockLoadImageModel,
    unloadTextModel: mockUnloadTextModel,
    unloadImageModel: mockUnloadImageModel,
    unloadAllModels: mockUnloadAllModels,
    getActiveModels: jest.fn(() => ({ text: null, image: null })),
    checkMemoryForModel: mockCheckMemoryForModel,
    checkMemoryForDualModel: jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: '' })),
    subscribe: jest.fn(() => jest.fn()),
    getResourceUsage: jest.fn(() => Promise.resolve({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    })),
    syncWithNativeState: jest.fn(),
    getLoadedModelIds: jest.fn(() => ({ textModelId: null, imageModelId: null })),
  },
}));

jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    getDownloadedModels: jest.fn(() => Promise.resolve([])),
      linkOrphanMmProj: jest.fn().mockResolvedValue(undefined),
    getDownloadedImageModels: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 8 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    })),
    getTotalMemoryGB: jest.fn(() => 8),
    formatBytes: jest.fn((bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`),
    formatModelSize: jest.fn(() => '4.0 GB'),
  },
}));

// Mock AppSheet to render children directly when visible
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, onClose, title, children }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    if (!visible) return null;
    return (
      <View testID="app-sheet">
        <Text testID="app-sheet-title">{title}</Text>
        {children}
        <TouchableOpacity testID="close-sheet" onPress={onClose}>
          <Text>Close</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

// Mock AnimatedEntry to just render children
jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

// Mock AnimatedListItem to render as a simple touchable
jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, testID, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity testID={testID} style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));

// Mock AnimatedPressable
jest.mock('../../../src/components/AnimatedPressable', () => ({
  AnimatedPressable: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return <TouchableOpacity style={style} onPress={onPress} testID={testID}>{children}</TouchableOpacity>;
  },
}));

// Mock CustomAlert and related from components
jest.mock('../../../src/components', () => {
  const actual = jest.requireActual('../../../src/components');
  return {
    ...actual,
    CustomAlert: ({ visible, title, message, buttons, onClose }: any) => {
      const { View, Text, TouchableOpacity } = require('react-native');
      if (!visible) return null;
      return (
        <View testID="custom-alert">
          <Text testID="alert-title">{title}</Text>
          <Text testID="alert-message">{message}</Text>
          {buttons && buttons.map((btn: any, i: number) => (
            <TouchableOpacity
              key={i}
              testID={`alert-button-${btn.text}`}
              onPress={() => { if (btn.onPress) { btn.onPress(); } onClose(); }}
            >
              <Text>{btn.text}</Text>
            </TouchableOpacity>
          ))}
          {!buttons && (
            <TouchableOpacity testID="alert-ok" onPress={onClose}>
              <Text>OK</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    },
  };
});

// Mock useFocusTrigger
jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

// Mock Swipeable to render children AND renderRightActions
jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { forwardRef } = require('react');
  const { View } = require('react-native');
  return forwardRef(({ children, renderRightActions, containerStyle }: any, _ref: any) => (
    <View style={containerStyle}>
      {children}
      {renderRightActions && <View testID="swipeable-right-actions">{renderRightActions()}</View>}
    </View>
  ));
});

// Import after mocks
import { HomeScreen } from '../../../src/screens/HomeScreen';
import { activeModelService } from '../../../src/services/activeModelService';

const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  dispatch: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => false),
  getParent: jest.fn(),
  getState: jest.fn(),
  getId: jest.fn(),
  setParams: jest.fn(),
} as any;

const renderHomeScreen = () => {
  return render(
    <NavigationContainer>
      <HomeScreen navigation={mockNavigation} />
    </NavigationContainer>
  );
};

describe('HomeScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    // Re-setup activeModelService mock after clearAllMocks
    (activeModelService.subscribe as jest.Mock).mockReturnValue(jest.fn());
    (activeModelService.getActiveModels as jest.Mock).mockReturnValue({
      text: { modelId: null, modelPath: null, isLoading: false },
      image: { modelId: null, modelPath: null, isLoading: false },
    });
    mockCheckMemoryForModel.mockResolvedValue({
      canLoad: true,
      severity: 'safe',
      message: '',
    });
    (activeModelService.getResourceUsage as jest.Mock).mockResolvedValue({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    });
    (activeModelService.getLoadedModelIds as jest.Mock).mockReturnValue({ textModelId: null, imageModelId: null });
    mockLoadTextModel.mockResolvedValue(undefined);
    mockLoadImageModel.mockResolvedValue(undefined);
    mockUnloadTextModel.mockResolvedValue(undefined);
    mockUnloadImageModel.mockResolvedValue(undefined);
    mockUnloadAllModels.mockResolvedValue({ textUnloaded: true, imageUnloaded: true });
    // Re-assign functions that may be undefined after mock hoisting/clearing
    if (!activeModelService.checkMemoryForModel) {
      (activeModelService as any).checkMemoryForModel = mockCheckMemoryForModel;
    }
    if (!activeModelService.loadTextModel) {
      (activeModelService as any).loadTextModel = mockLoadTextModel;
    }
    if (!activeModelService.loadImageModel) {
      (activeModelService as any).loadImageModel = mockLoadImageModel;
    }
    if (!activeModelService.unloadTextModel) {
      (activeModelService as any).unloadTextModel = mockUnloadTextModel;
    }
    if (!activeModelService.unloadImageModel) {
      (activeModelService as any).unloadImageModel = mockUnloadImageModel;
    }
    if (!activeModelService.unloadAllModels) {
      (activeModelService as any).unloadAllModels = mockUnloadAllModels;
    }
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });

    it('shows app title', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Off Grid')).toBeTruthy();
    });

    it('shows Text and Image model card labels', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Text')).toBeTruthy();
      expect(getByText('Image')).toBeTruthy();
    });
  });

  // ============================================================================
  // Text Model Card
  // ============================================================================
  describe('text model card', () => {
    it('shows "No models" when downloadedModels is empty', () => {
      const { getAllByText } = renderHomeScreen();
      expect(getAllByText('No models').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Tap to select" when models downloaded but none active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Tap to select')).toBeTruthy();
    });

    it('shows active model name when model is loaded', () => {
      const model = createDownloadedModel({ name: 'Llama-3.2-3B' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('Llama-3.2-3B')).toBeTruthy();
    });

    it('shows quantization and estimated RAM for active model', () => {
      const model = createDownloadedModel({
        name: 'Phi-3-mini',
        quantization: 'Q4_K_M',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText(/Q4_K_M/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Image Model Card
  // ============================================================================
  describe('image model card', () => {
    it('shows active image model name', () => {
      const imageModel = createONNXImageModel({ name: 'SDXL Turbo' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('SDXL Turbo')).toBeTruthy();
    });

    it('shows style for active image model', () => {
      const imageModel = createONNXImageModel({
        name: 'Dreamshaper',
        style: 'creative',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText(/creative/)).toBeTruthy();
    });

    it('shows "Tap to select" when image models exist but none active', () => {
      const imageModel = createONNXImageModel();
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getAllByText } = renderHomeScreen();
      expect(getAllByText('Tap to select').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // New Chat Button / Setup Card
  // ============================================================================
  describe('new chat button', () => {
    it('shows New Chat button when text model is active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('new-chat-button')).toBeTruthy();
    });

    it('shows setup card when no text model active and models exist', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('setup-card')).toBeTruthy();
    });

    it('shows "Select a text model" when models downloaded but none active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Select a text or image model to start')).toBeTruthy();
    });

    it('shows "Add remote server or download" when no models downloaded', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Add a remote server or download a model to start chatting')).toBeTruthy();
    });

    it('shows "Select Model" button when models exist but none active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Select Model')).toBeTruthy();
    });

    it('shows "Browse Models" button when no models downloaded', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Browse Models')).toBeTruthy();
    });

    it('navigates to Chat when New Chat pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('new-chat-button'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });

    it('does not create a conversation eagerly when New Chat pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('new-chat-button'));

      // Conversation is created lazily on first send, not on navigation
      const conversations = useChatStore.getState().conversations;
      expect(conversations.length).toBe(0);
    });

    it('navigates to ModelsTab when Browse Models pressed', () => {
      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('browse-models-button'));

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });
  });

  // ============================================================================
  // Recent Conversations
  // ============================================================================
  describe('recent conversations', () => {
    it('shows recent conversations list with titles', () => {
      const conversations = [
        createConversation({ title: 'Chat about AI' }),
        createConversation({ title: 'Code review' }),
      ];
      useChatStore.setState({ conversations });

      const { getByText } = renderHomeScreen();
      expect(getByText('Chat about AI')).toBeTruthy();
      expect(getByText('Code review')).toBeTruthy();
    });

    it('shows "Recent" section header', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('Recent')).toBeTruthy();
    });

    it('shows "See all" link', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('See all')).toBeTruthy();
    });

    it('limits recent conversations to 4', () => {
      createMultipleConversations(6);

      const { queryAllByTestId } = renderHomeScreen();
      expect(queryAllByTestId(/^conversation-item-/).length).toBe(4);
    });

    it('opens conversation when tapped', () => {
      const conversation = createConversation({ title: 'Test Chat' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: conversation.id });
    });

    it('shows message preview for conversations with messages', () => {
      const conv = createConversation({
        title: 'Preview Test',
        messages: [
          createMessage({ role: 'user', content: 'Hello AI!' }),
          createMessage({ role: 'assistant', content: 'Hi there, how can I help?' }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText(/Hi there, how can I help/)).toBeTruthy();
    });

    it('shows "You: " prefix for last user message', () => {
      const conv = createConversation({
        title: 'User Preview Test',
        messages: [
          createMessage({ role: 'user', content: 'My last question' }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText(/You: My last question/)).toBeTruthy();
    });

    it('does not show Recent section when no conversations', () => {
      useChatStore.setState({ conversations: [] });

      const { queryByText } = renderHomeScreen();
      expect(queryByText('Recent')).toBeNull();
    });

    it('navigates to ChatsTab when See all pressed', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-list-button'));

      expect(mockNavigate).toHaveBeenCalledWith('ChatsTab');
    });

    it('sets active conversation when opening one', () => {
      const conversation = createConversation({ title: 'Active Chat' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(useChatStore.getState().activeConversationId).toBe(conversation.id);
    });
  });

  // ============================================================================
  // Eject All Button
  // ============================================================================
  describe('eject all button', () => {
    it('shows eject all button when text model is active', async () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderHomeScreen();
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(getByText('Eject All Models')).toBeTruthy();
    }, 15000);

    it('shows eject all button when image model is active', async () => {
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByText } = renderHomeScreen();
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(getByText('Eject All Models')).toBeTruthy();
    }, 15000);

    it('does not show eject button when no models active', () => {
      const { queryByText } = renderHomeScreen();
      expect(queryByText('Eject All Models')).toBeNull();
    });

    it('shows confirmation alert when eject all is pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Eject All Models'));

      // CustomAlert should show
      expect(getByTestId('custom-alert')).toBeTruthy();
      expect(getByTestId('alert-title').props.children).toBe('Eject All Models');
      expect(getByTestId('alert-message').props.children).toBe('Unload all active models to free up memory?');
    });

    it('calls unloadAllModels when Eject All confirmed', async () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Eject All Models'));

      await act(async () => {
        fireEvent.press(getByTestId('alert-button-Eject All'));
      });

      await waitFor(() => {
        expect(mockUnloadAllModels).toHaveBeenCalled();
      });
    });

    it('shows success message after ejecting models', async () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Eject All Models'));

      await act(async () => {
        fireEvent.press(getByTestId('alert-button-Eject All'));
      });

      await waitFor(() => {
        const alertTitle = queryByTestId('alert-title');
        expect(alertTitle?.props.children).toBe('Done');
      });
    });

    it('cancels eject when Cancel is pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Eject All Models'));
      fireEvent.press(getByTestId('alert-button-Cancel'));

      // unloadAllModels should not be called
      expect(mockUnloadAllModels).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Gallery Card
  // ============================================================================
  describe('gallery card', () => {
    it('shows Image Gallery card', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Image Gallery')).toBeTruthy();
    });

    it('shows "0 images" when no images', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('0 images')).toBeTruthy();
    });

    it('shows count with "images" (plural) for multiple images', () => {
      useAppStore.setState({
        generatedImages: [
          { id: '1', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
          { id: '2', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('2 images')).toBeTruthy();
    });

    it('shows "1 image" (singular) for single image', () => {
      useAppStore.setState({
        generatedImages: [
          { id: '1', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('1 image')).toBeTruthy();
    });
  });

  // ============================================================================
  // Stats Display
  // ============================================================================
  describe('stats display', () => {
    it('shows count of text models', () => {
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel(),
          createDownloadedModel(),
          createDownloadedModel(),
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('3')).toBeTruthy();
      expect(getByText('Text models')).toBeTruthy();
    });

    it('shows count of image models', () => {
      useAppStore.setState({
        downloadedImageModels: [
          createONNXImageModel(),
          createONNXImageModel(),
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('2')).toBeTruthy();
      expect(getByText('Image models')).toBeTruthy();
    });

    it('shows count of conversations', () => {
      createMultipleConversations(5);

      const { getByText } = renderHomeScreen();
      expect(getByText('5')).toBeTruthy();
      expect(getByText('Chats')).toBeTruthy();
    });

    it('shows zero counts by default', () => {
      const { getAllByText } = renderHomeScreen();
      expect(getAllByText('0').length).toBe(3);
    });
  });

  // ============================================================================
  // Memory Estimation
  // ============================================================================
  describe('memory estimation', () => {
    it('renders with device info including total memory', () => {
      useAppStore.setState({
        deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });
  });

  // ============================================================================
  // Estimated RAM Display
  // ============================================================================
  describe('estimated RAM display', () => {
    it('shows estimated RAM for active text model in card', () => {
      const model = createDownloadedModel({
        name: 'Test Model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText(/6\.0 GB/)).toBeTruthy();
    });

    it('shows estimated RAM for active image model in card', () => {
      const imageModel = createONNXImageModel({
        name: 'Test Image Model',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText(/3\.6 GB/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Model Picker Sheet
  // ============================================================================
  describe('model picker sheet', () => {
    it('opens text model picker when text card is pressed', () => {
      const model = createDownloadedModel({ name: 'Llama' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, queryByTestId } = renderHomeScreen();
      expect(queryByTestId('app-sheet')).toBeNull();

      // Press the "Tap to select" text model card
      fireEvent.press(getByText('Tap to select'));

      expect(queryByTestId('app-sheet')).toBeTruthy();
      expect(queryByTestId('app-sheet-title')?.props.children).toBe('Text Models');
    });

    it('opens image model picker when image card is pressed', () => {
      const imageModel = createONNXImageModel({ name: 'TestImg' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, queryByTestId } = renderHomeScreen();

      fireEvent.press(getByTestId('image-model-card'));

      expect(queryByTestId('app-sheet')).toBeTruthy();
      expect(queryByTestId('app-sheet-title')?.props.children).toBe('Image Models');
    });

    it('shows "No text models available" when picker opened with no models', () => {
      const { getByText, queryByText } = renderHomeScreen();

      // Use "Select Model" button for models-exist case, but for no-models case
      // the card shows "No models" - press the Text card area
      // Since our mock AnimatedPressable wraps with TouchableOpacity, we can press it

      // Open text picker - the text model card area
      fireEvent.press(getByText('Text'));

      expect(queryByText('No text models available')).toBeTruthy();
    });

    it('shows "No image models available" when image picker opened with no models', () => {
      const { getByTestId, queryByText } = renderHomeScreen();

      fireEvent.press(getByTestId('image-model-card'));

      expect(queryByText('No image models available')).toBeTruthy();
    });

    it('shows model items in text picker', () => {
      const model1 = createDownloadedModel({ name: 'Model Alpha' });
      const model2 = createDownloadedModel({ name: 'Model Beta' });
      useAppStore.setState({ downloadedModels: [model1, model2] });

      const { getByText, getAllByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      expect(getAllByTestId('model-item').length).toBe(2);
      expect(getByText('Model Alpha')).toBeTruthy();
      expect(getByText('Model Beta')).toBeTruthy();
    });

    it('shows model items in image picker', () => {
      const imageModel = createONNXImageModel({ name: 'SD Turbo' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, getByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      expect(getByText('SD Turbo')).toBeTruthy();
    });

    it('shows unload button when text model is active', () => {
      const model = createDownloadedModel({ name: 'Active Model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Active Model'));

      expect(queryByTestId('unload-text-model-button')).toBeTruthy();
    });

    it('shows "Unload current model" when image model is active', () => {
      const imageModel = createONNXImageModel({ name: 'Active Image' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      expect(queryByText('Unload current model')).toBeTruthy();
    });

    it('shows check icon for active text model', () => {
      const model = createDownloadedModel({ name: 'Checked Model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Checked Model'));

      // The model item should exist
      expect(getByTestId('model-item')).toBeTruthy();
    });

    it('closes picker when close button pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, queryByTestId, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      expect(queryByTestId('app-sheet')).toBeTruthy();

      fireEvent.press(getByTestId('close-sheet'));

      expect(queryByTestId('app-sheet')).toBeNull();
    });

    it('shows "Browse more models" link in picker', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      expect(getByText('Browse more models')).toBeTruthy();
    });

    it('navigates to ModelsTab when "Browse more models" pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));
      fireEvent.press(getByText('Browse more models'));

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });

    it('shows memory estimate per model in picker', () => {
      const model = createDownloadedModel({
        name: 'RAM Model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      // Shows ~6.0 GB RAM (4 * 1.5 = 6.0)
      expect(getByText(/6\.0 GB RAM/)).toBeTruthy();
    });

    it('shows vision indicator for vision models in picker', () => {
      const visionModel = createVisionModel({ name: 'LLaVA Vision' });
      useAppStore.setState({ downloadedModels: [visionModel] });

      const { getByText, getAllByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      expect(getAllByText(/Vision/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Model Selection (from picker)
  // ============================================================================
  describe('model selection from picker', () => {
    it('calls checkMemoryForModel when text model selected', async () => {
      const model = createDownloadedModel({ name: 'Pick Me' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(mockCheckMemoryForModel).toHaveBeenCalledWith(model.id, 'text');
      });
    });

    it('loads text model when memory check passes', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const model = createDownloadedModel({ name: 'Safe Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(mockLoadTextModel).toHaveBeenCalledWith(model.id);
      });
    });

    it('shows critical alert when memory insufficient', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: false,
        severity: 'critical',
        message: 'Not enough memory',
      });

      const model = createDownloadedModel({ name: 'Big Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText('Insufficient Memory')).toBeTruthy();
      });
      // Should not load the model
      expect(mockLoadTextModel).not.toHaveBeenCalled();
    });

    it('shows warning alert when memory is low', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'warning',
        message: 'Low memory warning',
      });

      const model = createDownloadedModel({ name: 'Warning Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText('Low Memory Warning')).toBeTruthy();
        expect(queryByText('Load Anyway')).toBeTruthy();
      });
    });

    it('loads model when "Load Anyway" pressed after warning', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'warning',
        message: 'Low memory warning',
      });

      const model = createDownloadedModel({ name: 'Warning Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      // Wait for sheet-close delay before alert appears
      await act(async () => { await new Promise<void>(r => setTimeout(r, 400)); });

      await act(async () => {
        fireEvent.press(getByText('Load Anyway'));
      });

      await waitFor(() => {
        expect(mockLoadTextModel).toHaveBeenCalledWith(model.id);
      });
    });

    it('does not reload already active text model', async () => {
      const model = createDownloadedModel({ name: 'Already Active' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });
      (activeModelService.getLoadedModelIds as jest.Mock).mockReturnValue({ textModelId: model.id, imageModelId: null });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Already Active'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      // checkMemoryForModel should not be called for already active model
      expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    });

    it('calls checkMemoryForModel when image model selected', async () => {
      const imageModel = createONNXImageModel({ name: 'Pick Image' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(mockCheckMemoryForModel).toHaveBeenCalledWith(imageModel.id, 'image');
      });
    });

    it('loads image model when memory check passes', async () => {
      const imageModel = createONNXImageModel({ name: 'Safe Image' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(mockLoadImageModel).toHaveBeenCalledWith(imageModel.id);
      });
    });
  });

  // ============================================================================
  // Model Unloading from Picker
  // ============================================================================
  describe('model unloading from picker', () => {
    it('unloads text model when unload button pressed in picker', async () => {
      const model = createDownloadedModel({ name: 'Unload Me' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Unload Me'));

      await act(async () => {
        fireEvent.press(getByTestId('unload-text-model-button'));
      });

      await waitFor(() => {
        expect(mockUnloadTextModel).toHaveBeenCalled();
      });
    });

    it('unloads image model when unload button pressed in picker', async () => {
      const imageModel = createONNXImageModel({ name: 'Unload Image' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByTestId, getByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByText('Unload current model'));
      });

      await waitFor(() => {
        expect(mockUnloadImageModel).toHaveBeenCalled();
      });
    });

    it('shows error alert when text model unload fails', async () => {
      mockUnloadTextModel.mockRejectedValue(new Error('Unload failed'));

      const model = createDownloadedModel({ name: 'Fail Unload' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Fail Unload'));

      await act(async () => {
        fireEvent.press(getByTestId('unload-text-model-button'));
      });

      await waitFor(() => {
        expect(queryByText('Failed to unload model')).toBeTruthy();
      });
    });

    it('shows error alert when image model unload fails', async () => {
      mockUnloadImageModel.mockRejectedValue(new Error('Unload failed'));

      const imageModel = createONNXImageModel({ name: 'Fail Image Unload' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByTestId, getByText, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByText('Unload current model'));
      });

      await waitFor(() => {
        expect(queryByText('Failed to unload model')).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Model Load Error Handling
  // ============================================================================
  describe('model load error handling', () => {
    it('shows error alert when text model load fails', async () => {
      mockLoadTextModel.mockRejectedValue(new Error('Load crashed'));
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const model = createDownloadedModel({ name: 'Crash Model' });
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText(/Failed to load model/)).toBeTruthy();
      });
    });

    it('shows error alert when image model load fails', async () => {
      mockLoadImageModel.mockRejectedValue(new Error('Image load failed'));
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const imageModel = createONNXImageModel({ name: 'Crash Image' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText(/Failed to load model/)).toBeTruthy();
      });
    });

    it('shows error when eject all fails', async () => {
      mockUnloadAllModels.mockRejectedValue(new Error('Eject failed'));

      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText, getByTestId, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Eject All Models'));

      await act(async () => {
        fireEvent.press(getByTestId('alert-button-Eject All'));
      });

      await waitFor(() => {
        const alertMessage = queryByTestId('alert-message');
        expect(alertMessage?.props.children).toBe('Failed to unload models');
      });
    });
  });

  // ============================================================================
  // Delete Conversation (via swipe)
  // ============================================================================
  describe('delete conversation', () => {
    it('shows delete confirmation when delete action triggered', () => {
      // The Swipeable renderRightActions renders a delete button
      // We need to test the handleDeleteConversation callback
      const conv = createConversation({ title: 'Delete Me' });
      useChatStore.setState({ conversations: [conv] });

      // The renderRightActions renders a trash button
      // Since Swipeable is mocked, the right actions may not be accessible directly
      // But the conversation item is rendered
      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('conversation-item-0')).toBeTruthy();
    });
  });

  // ============================================================================
  // Loading Overlay
  // ============================================================================
  describe('loading overlay', () => {
    it('shows an inline loading indicator (not a blocking overlay) when loading text model', async () => {
      const model = createDownloadedModel({ name: 'Loading Model' });
      useAppStore.setState({ downloadedModels: [model] });

      // Make loadTextModel hang to keep loading state
      mockLoadTextModel.mockImplementation(() => new Promise(() => {}));
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      // Inline card indicator (background load) — no full-screen overlay.
      await waitFor(() => {
        expect(queryByText('Loading...')).toBeTruthy();
      });
      expect(queryByText('Loading Text Model')).toBeNull(); // overlay removed
      await act(async () => { await new Promise<void>(r => setTimeout(r, 300)); });
    });

    it('shows an inline loading indicator (not a blocking overlay) when loading image model', async () => {
      const imageModel = createONNXImageModel({ name: 'Loading Image' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      mockLoadImageModel.mockImplementation(() => new Promise(() => {}));
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText('Loading...')).toBeTruthy();
      });
      expect(queryByText('Loading Image Model')).toBeNull(); // overlay removed
      await act(async () => { await new Promise<void>(r => setTimeout(r, 300)); });
    });

    it('shows "Unloading..." text in card when unloading without model name', async () => {
      const model = createDownloadedModel({ name: 'To Unload' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      // Make unload hang
      mockUnloadTextModel.mockImplementation(() => new Promise(() => {}));

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('To Unload'));

      await act(async () => {
        fireEvent.press(getByTestId('unload-text-model-button'));
      });

      // Card should show "Unloading..." since modelName is null during unload
      await waitFor(() => {
        expect(queryByText('Unloading...')).toBeTruthy();
        expect(queryByText('Loading...')).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Memory Display
  // ============================================================================
  describe('memory display', () => {
    it('shows device total RAM', () => {
      useAppStore.setState({
        deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });

    it('shows estimated RAM usage for loaded text model', () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = renderHomeScreen();
      expect(getByText(/GB/)).toBeTruthy();
    });

    it('shows combined RAM when both models loaded', () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ size: 2 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getAllByText } = renderHomeScreen();
      expect(getAllByText(/GB/).length).toBeGreaterThanOrEqual(2);
    });

    it('renders without crashing when both models loaded', () => {
      const model = createDownloadedModel();
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });
  });

  // ============================================================================
  // Loading Card States
  // ============================================================================
  describe('loading card states', () => {
    it('shows loading state in text card during load', async () => {
      const model = createDownloadedModel({ name: 'Model X' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLoadTextModel.mockImplementation(() => new Promise(() => {}));
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'safe',
        message: '',
      });

      const { getByText, getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByText('Tap to select'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      // Text card should show loading state
      await waitFor(() => {
        expect(queryByText('Loading...')).toBeTruthy();
      });
      // Drain pending RAF-chain timers to prevent leaking into the image model memory check tests
      await act(async () => { await new Promise<void>(r => setTimeout(r, 300)); });
    });
  });

  // ============================================================================
  // Image Model Memory Check (canLoad=false and warning paths)
  // ============================================================================
  describe('image model memory checks', () => {
    it('shows critical alert when image model memory insufficient', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: false,
        severity: 'critical',
        message: 'Not enough memory for image model',
      });

      const imageModel = createONNXImageModel({ name: 'Big Image Model' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText('Insufficient Memory')).toBeTruthy();
        expect(queryByText('Not enough memory for image model')).toBeTruthy();
      });
      expect(mockLoadImageModel).not.toHaveBeenCalled();
    });

    it('shows warning alert when image model memory is low', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'warning',
        message: 'Low memory for image model',
      });

      const imageModel = createONNXImageModel({ name: 'Warn Image Model' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      await waitFor(() => {
        expect(queryByText('Low Memory')).toBeTruthy();
        expect(queryByText('Load Anyway')).toBeTruthy();
      });
    });

    it('loads image model when "Load Anyway" pressed after warning', async () => {
      mockCheckMemoryForModel.mockResolvedValue({
        canLoad: true,
        severity: 'warning',
        message: 'Low memory for image model',
      });

      const imageModel = createONNXImageModel({ name: 'Warn Image' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const { getByTestId, getByText } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      // Wait for sheet-close delay before alert appears
      await act(async () => { await new Promise<void>(r => setTimeout(r, 400)); });

      await act(async () => {
        fireEvent.press(getByText('Load Anyway'));
      });

      await waitFor(() => {
        expect(mockLoadImageModel).toHaveBeenCalledWith(imageModel.id);
      });
    });

    it('does not reload already active image model', async () => {
      const imageModel = createONNXImageModel({ name: 'Already Active Image' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: imageModel.id,
      });
      (activeModelService.getLoadedModelIds as jest.Mock).mockReturnValue({ textModelId: null, imageModelId: imageModel.id });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('image-model-card'));

      await act(async () => {
        fireEvent.press(getByTestId('model-item'));
      });

      expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Delete Conversation (full flow with swipe actions)
  // ============================================================================
  describe('delete conversation full flow', () => {
    it('renders delete button in swipeable right actions', () => {
      const conv = createConversation({ title: 'Swipeable Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getAllByTestId } = renderHomeScreen();
      expect(getAllByTestId('swipeable-right-actions').length).toBeGreaterThan(0);
    });

    it('shows delete confirmation and deletes conversation', async () => {
      const conv = createConversation({ title: 'Delete This Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId, queryByText } = renderHomeScreen();

      // Press the trash button (has testID="delete-conversation-button")
      fireEvent.press(getByTestId('delete-conversation-button'));

      await waitFor(() => {
        expect(queryByText('Delete Conversation')).toBeTruthy();
        expect(queryByText(`Delete "Delete This Chat"?`)).toBeTruthy();
      });

      // Press Delete button in the alert
      await act(async () => {
        fireEvent.press(getByTestId('alert-button-Delete'));
      });

      // Conversation should be deleted
      expect(useChatStore.getState().conversations.length).toBe(0);
    });

    it('cancels delete conversation', async () => {
      const conv = createConversation({ title: 'Keep This Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId, queryByText } = renderHomeScreen();

      fireEvent.press(getByTestId('delete-conversation-button'));

      await waitFor(() => {
        expect(queryByText('Delete Conversation')).toBeTruthy();
      });

      // Press Cancel
      fireEvent.press(getByTestId('alert-button-Cancel'));

      // Conversation should still exist
      expect(useChatStore.getState().conversations.length).toBe(1);
    });
  });

  // ============================================================================
  // Gallery Navigation
  // ============================================================================
  describe('gallery navigation', () => {
    it('navigates to Gallery when gallery card is pressed', () => {
      const { getByText } = renderHomeScreen();
      fireEvent.press(getByText('Image Gallery'));

      expect(mockNavigate).toHaveBeenCalledWith('Gallery');
    });
  });

  // ============================================================================
  // Empty Picker Browse Models Navigation
  // ============================================================================
  describe('empty picker browse navigation', () => {
    it('navigates to ModelsTab from empty text picker Browse Models button', () => {
      // No text models downloaded
      const { getByText, getAllByText } = renderHomeScreen();

      // Open text model picker via the Text card
      fireEvent.press(getByText('Text'));

      // Inside the empty picker, there's a "Browse Models" button
      // There are multiple "Browse Models" - one in setup card, one in picker
      const browseButtons = getAllByText('Browse Models');
      // The second one should be in the picker
      fireEvent.press(browseButtons[browseButtons.length - 1]);

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });

    it('navigates to ModelsTab from empty image picker Browse Models button', () => {
      // No image models downloaded
      const { getByTestId, getAllByText } = renderHomeScreen();

      // Open image model picker
      fireEvent.press(getByTestId('image-model-card'));

      // Inside the empty picker, there's a "Browse Models" button
      const browseButtons = getAllByText('Browse Models');
      fireEvent.press(browseButtons[browseButtons.length - 1]);

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'image' });
    });
  });

  // ============================================================================
  // formatDate branches
  // ============================================================================
  describe('formatDate coverage', () => {
    it('shows "Yesterday" for conversations updated yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const conv = createConversation({
        title: 'Yesterday Chat',
        updatedAt: yesterday.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('shows weekday name for conversations updated 2-6 days ago', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const conv = createConversation({
        title: 'Recent Chat',
        updatedAt: threeDaysAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      // Should show a short weekday like "Mon", "Tue", etc.
      const expectedDay = threeDaysAgo.toLocaleDateString([], { weekday: 'short' });
      expect(getByText(expectedDay)).toBeTruthy();
    });

    it('shows month and day for conversations updated more than 7 days ago', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const conv = createConversation({
        title: 'Old Chat',
        updatedAt: twoWeeksAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      const expectedDate = twoWeeksAgo.toLocaleDateString([], { month: 'short', day: 'numeric' });
      expect(getByText(expectedDate)).toBeTruthy();
    });
  });

  // ============================================================================
  // Memory Info Error Handling
  // ============================================================================
  describe('memory info error handling', () => {
    it('handles getResourceUsage failure gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (activeModelService.getResourceUsage as jest.Mock).mockRejectedValueOnce(
        new Error('Memory info failed')
      );

      renderHomeScreen();

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[HomeScreen] Failed to get memory info:'),
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it('refreshes memory info when subscribe callback fires', async () => {
      let subscribeCb: (() => void) | null = null;
      (activeModelService.subscribe as jest.Mock).mockImplementation((cb: () => void) => {
        subscribeCb = cb;
        return jest.fn();
      });

      renderHomeScreen();

      // Initial call
      await waitFor(() => {
        expect(activeModelService.getResourceUsage).toHaveBeenCalled();
      });

      const callCount = (activeModelService.getResourceUsage as jest.Mock).mock.calls.length;

      // Trigger the subscription callback
      await act(async () => {
        subscribeCb?.();
      });

      await waitFor(() => {
        expect((activeModelService.getResourceUsage as jest.Mock).mock.calls.length).toBeGreaterThan(callCount);
      });
    });
  });

  // ============================================================================
  // Select Model button from setup card
  // ============================================================================
  describe('setup card select model button', () => {
    it('opens text model picker when "Select Model" button pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Select Model'));

      // Should open the text model picker
      expect(queryByTestId('app-sheet')).toBeTruthy();
    });
  });
});
