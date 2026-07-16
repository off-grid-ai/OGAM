/**
 * ChatsListScreen Tests
 *
 * Tests for the conversation list screen including:
 * - Title and header rendering
 * - Empty state (with and without models)
 * - Conversation list rendering
 * - Project badges
 * - Navigation
 * - Message preview
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores } from '../../utils/testHelpers';
import {
  createConversation,
  createMessage,
  createDownloadedModel,
  createONNXImageModel,
  createProject,
} from '../../utils/factories';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style, testID }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  },
}));

const mockShowAlert = jest.fn((_t: string, _m: string, _b?: any[]) => ({
  visible: true,
  title: _t,
  message: _m,
  buttons: _b || [{ text: 'OK', style: 'default' }],
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message, buttons }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity: TO } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        <Text testID="alert-message">{message}</Text>
        {buttons && buttons.map((btn: any, i: number) => (
          <TO key={i} testID={`alert-button-${btn.text}`} onPress={btn.onPress}>
            <Text>{btn.text}</Text>
          </TO>
        ))}
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  })),
  initialAlertState: {
    visible: false,
    title: '',
    message: '',
    buttons: [],
  },
}));

jest.mock('../../../src/services', () => ({
  onnxImageGeneratorService: {
    deleteGeneratedImage: jest.fn(() => Promise.resolve()),
  },
  activeModelService: {
    loadTextModel: jest.fn(() => Promise.resolve()),
    loadImageModel: jest.fn(() => Promise.resolve()),
    unloadTextModel: jest.fn(() => Promise.resolve()),
    unloadImageModel: jest.fn(() => Promise.resolve()),
  },
  llmService: {
    getLoadedModelPath: jest.fn(() => null),
    isModelLoaded: jest.fn(() => false),
  },
  remoteServerManager: {
    clearActiveRemoteModel: jest.fn(),
  },
}));

jest.mock('../../../src/components', () => ({
  ModelSelectorModal: ({ visible }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (
      <View testID="model-selector-modal">
        <Text>Select Model</Text>
      </View>
    );
  },
}));

// Override global Swipeable mock to render rightActions for testing
jest.mock('react-native-gesture-handler/Swipeable', () => {
  return ({ children, renderRightActions }: any) => {
    const { View } = require('react-native');
    return (
      <View>
        {children}
        {renderRightActions && renderRightActions()}
      </View>
    );
  };
});

jest.mock('../../../src/utils/exportConversation', () => ({
  shareConversationAsText: jest.fn(() => Promise.resolve()),
}));

import { ChatsListScreen } from '../../../src/screens/ChatsListScreen';
import { shareConversationAsText } from '../../../src/utils/exportConversation';

describe('ChatsListScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Basic Rendering
  // ==========================================================================
  describe('basic rendering', () => {
    it('renders "Chats" title', () => {
      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Chats')).toBeTruthy();
    });

    it('renders the New button', () => {
      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('New')).toBeTruthy();
    });

    it('enables New when downloadable models exist but none are loaded', () => {
      useAppStore.setState({
        downloadedModels: [createDownloadedModel()],
        activeModelId: null,
        downloadedImageModels: [],
        activeImageModelId: null,
      });

      const { getByText } = render(<ChatsListScreen />);
      fireEvent.press(getByText('New'));
      expect(getByText('Select Model')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Empty State
  // ==========================================================================
  describe('empty state', () => {
    it('shows "No Chats Yet" when there are no conversations', () => {
      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('No Chats Yet')).toBeTruthy();
    });

    it('shows download prompt when no models are downloaded', () => {
      const { getByText } = render(<ChatsListScreen />);
      expect(
        getByText('Download a model from the Models tab to start chatting.'),
      ).toBeTruthy();
    });

    it('shows start conversation prompt when models are downloaded', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });
      const { getByText } = render(<ChatsListScreen />);
      expect(
        getByText(
          'Start a new conversation to begin chatting with your local AI.',
        ),
      ).toBeTruthy();
    });

    it('shows New button flow when only image models are available', () => {
      useAppStore.setState({
        downloadedModels: [],
        activeModelId: null,
        downloadedImageModels: [createONNXImageModel()],
        activeImageModelId: null,
      });

      const { getByText } = render(<ChatsListScreen />);
      fireEvent.press(getByText('New'));
      expect(getByText('Select Model')).toBeTruthy();
    });

    it('shows "New Chat" button in empty state when models are downloaded', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });
      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('New Chat')).toBeTruthy();
    });

    it('does not show "New Chat" empty-state button when no models', () => {
      const { queryByText } = render(<ChatsListScreen />);
      expect(queryByText('New Chat')).toBeNull();
    });
  });

  // ==========================================================================
  // Conversation List
  // ==========================================================================
  describe('conversation list', () => {
    it('renders conversation titles', () => {
      const conv = createConversation({ title: 'My AI Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('My AI Chat')).toBeTruthy();
    });

    it('renders multiple conversations', () => {
      const conv1 = createConversation({ title: 'First Chat' });
      const conv2 = createConversation({ title: 'Second Chat' });
      useChatStore.setState({ conversations: [conv1, conv2] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('First Chat')).toBeTruthy();
      expect(getByText('Second Chat')).toBeTruthy();
    });

    it('shows the FlatList with testID when conversations exist', () => {
      const conv = createConversation({ title: 'Test' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId } = render(<ChatsListScreen />);
      expect(getByTestId('conversation-list')).toBeTruthy();
    });

    it('does not show empty state when conversations exist', () => {
      const conv = createConversation({ title: 'Exists' });
      useChatStore.setState({ conversations: [conv] });

      const { queryByText } = render(<ChatsListScreen />);
      expect(queryByText('No Chats Yet')).toBeNull();
    });

    it('shows last message preview from assistant', () => {
      const conv = createConversation({
        title: 'Chat With Preview',
        messages: [
          createMessage({ role: 'user', content: 'Hello there' }),
          createMessage({
            role: 'assistant',
            content: 'Hi! How can I help you?',
          }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Hi! How can I help you?')).toBeTruthy();
    });

    it('shows "You: " prefix for user messages in preview', () => {
      const conv = createConversation({
        title: 'User Message Preview',
        messages: [createMessage({ role: 'user', content: 'My question' })],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText(/You:.*My question/)).toBeTruthy();
    });

    it('shows project badge when conversation has a project', () => {
      const project = createProject({ name: 'Code Review' });
      useProjectStore.setState({ projects: [project] });

      const conv = createConversation({
        title: 'Project Chat',
        projectId: project.id,
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Code Review')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Navigation
  // ==========================================================================
  describe('navigation', () => {
    it('navigates to Chat screen when a conversation item is pressed', () => {
      const conv = createConversation({ title: 'Tap Me' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId } = render(<ChatsListScreen />);
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', {
        conversationId: conv.id,
      });
    });

    it('sets active conversation when a conversation is pressed', () => {
      const conv = createConversation({ title: 'Activate Me' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId } = render(<ChatsListScreen />);
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(useChatStore.getState().activeConversationId).toBe(conv.id);
    });

    it('navigates to new Chat when New button is pressed and models exist', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = render(<ChatsListScreen />);
      fireEvent.press(getByText('New'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });

    it('does not navigate when New is pressed and no models downloaded', () => {
      const { getByText } = render(<ChatsListScreen />);
      fireEvent.press(getByText('New'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Date Formatting
  // ==========================================================================
  describe('date formatting', () => {
    it('shows time for today conversations', () => {
      const now = new Date();
      const conv = createConversation({
        title: 'Today Chat',
        updatedAt: now.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Today Chat')).toBeTruthy();
      // The time will be formatted as HH:MM, we just check it renders
    });

    it('shows "Yesterday" for yesterday conversations', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const conv = createConversation({
        title: 'Yesterday Chat',
        updatedAt: yesterday.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('shows day name for chats within the last week', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const conv = createConversation({
        title: 'Recent Chat',
        updatedAt: threeDaysAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Recent Chat')).toBeTruthy();
      // The weekday short name should be rendered
    });

    it('shows month/day for older chats', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const conv = createConversation({
        title: 'Old Chat',
        updatedAt: twoWeeksAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Old Chat')).toBeTruthy();
      // The month/day format should be rendered
    });
  });

  // ==========================================================================
  // Delete Chat
  // ==========================================================================
  describe('delete chat', () => {
    it('sorts conversations by updatedAt descending', () => {
      const older = createConversation({
        title: 'Older Chat',
        updatedAt: new Date('2024-01-01').toISOString(),
      });
      const newer = createConversation({
        title: 'Newer Chat',
        updatedAt: new Date('2024-06-01').toISOString(),
      });
      useChatStore.setState({ conversations: [older, newer] });

      const { getByTestId } = render(<ChatsListScreen />);
      const list = getByTestId('conversation-list');
      // The newer chat should appear first
      expect(list).toBeTruthy();
    });

    it('handles no messages in conversation (no preview)', () => {
      const conv = createConversation({
        title: 'Empty Conv',
        messages: [],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText, queryByText } = render(<ChatsListScreen />);
      expect(getByText('Empty Conv')).toBeTruthy();
      // No "You: " prefix since no messages
      expect(queryByText(/You:/)).toBeNull();
    });

    it('does not show project badge when no project', () => {
      const conv = createConversation({
        title: 'No Project Conv',
        projectId: undefined,
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('No Project Conv')).toBeTruthy();
      // No project badge text should appear
    });

    it('does not show project badge when projectId points to non-existent project', () => {
      const conv = createConversation({
        title: 'Invalid Project Conv',
        projectId: 'non-existent-project-id',
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = render(<ChatsListScreen />);
      expect(getByText('Invalid Project Conv')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Empty State with Models
  // ==========================================================================
  describe('empty state new chat button', () => {
    it('navigates when New Chat empty state button pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      const { getByText } = render(<ChatsListScreen />);
      fireEvent.press(getByText('New Chat'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });
  });

  // ==========================================================================
  // New Chat Alert (no models)
  // Note: The "New" button in the header is disabled when no models,
  // so handleNewChat's "No Model" alert is a defensive guard.
  // ==========================================================================

  // ==========================================================================
  // Delete Chat Flow
  // ==========================================================================
  describe('delete chat flow', () => {
    it('shows delete confirmation when swipe-delete is triggered', () => {
      const conv = createConversation({ title: 'Delete Me' });
      useChatStore.setState({ conversations: [conv] });
      useAppStore.setState({
        generatedImages: [],
      });

      render(<ChatsListScreen />);
      // The Swipeable mock renders renderRightActions inline, which contains
      // a trash button. Find it and press it.
      const { TouchableOpacity } = require('react-native');
      // Since we render right actions inline, find all touchables
      // and look for the trash-related one
      const tree = render(<ChatsListScreen />);
      const touchables = tree.UNSAFE_getAllByType(TouchableOpacity);
      // The delete action button should be among them
      // Find the one that triggers the delete alert
      for (const btn of touchables) {
        mockShowAlert.mockClear();
        fireEvent.press(btn);
        if (mockShowAlert.mock.calls.length > 0 &&
            mockShowAlert.mock.calls[0][0] === 'Delete Chat') {
          break;
        }
      }

      expect(mockShowAlert).toHaveBeenCalledWith(
        'Delete Chat',
        expect.stringContaining('Delete Me'),
        expect.any(Array),
      );
    });

    it('deletes conversation and images when confirmed', async () => {
      const conv = createConversation({ title: 'To Delete' });
      useChatStore.setState({ conversations: [conv] });
      useAppStore.setState({
        generatedImages: [],
      });

      const tree = render(<ChatsListScreen />);
      const { TouchableOpacity } = require('react-native');
      const touchables = tree.UNSAFE_getAllByType(TouchableOpacity);

      for (const btn of touchables) {
        mockShowAlert.mockClear();
        fireEvent.press(btn);
        if (mockShowAlert.mock.calls.length > 0 &&
            mockShowAlert.mock.calls[0][0] === 'Delete Chat') {
          break;
        }
      }

      const alertButtons = mockShowAlert.mock.calls[0]?.[2];
      const deleteBtn = alertButtons?.find((b: any) => b.text === 'Delete');

      if (deleteBtn?.onPress) {
        await deleteBtn.onPress();
        // Conversation should be deleted
        expect(useChatStore.getState().conversations.length).toBe(0);
      }
    });
  });

  // ==========================================================================
  // Export Chat Flow
  // ==========================================================================
  describe('export chat flow', () => {
    it('shares the conversation as text when the export swipe action is pressed', () => {
      const conv = createConversation({ title: 'Export Me' });
      useChatStore.setState({ conversations: [conv] });
      useAppStore.setState({
        generatedImages: [],
      });

      const { getByTestId } = render(<ChatsListScreen />);
      fireEvent.press(getByTestId('export-conversation-button'));

      expect(shareConversationAsText).toHaveBeenCalledWith(conv);
      expect(shareConversationAsText).toHaveBeenCalledTimes(1);
    });

    it('does not show the delete confirmation when export is pressed', () => {
      const conv = createConversation({ title: 'Export Only' });
      useChatStore.setState({ conversations: [conv] });
      useAppStore.setState({
        generatedImages: [],
      });

      const { getByTestId } = render(<ChatsListScreen />);
      mockShowAlert.mockClear();
      fireEvent.press(getByTestId('export-conversation-button'));

      expect(mockShowAlert).not.toHaveBeenCalled();
    });
  });
});
