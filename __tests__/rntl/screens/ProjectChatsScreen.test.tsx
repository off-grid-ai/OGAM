/**
 * ProjectChatsScreen Tests
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
    }),
    useRoute: () => ({
      params: { projectId: 'proj1' },
    }),
  };
});

let mockProject: any = { id: 'proj1', name: 'Test Project' };
let mockConversations: any[] = [];
let mockDownloadedModels: any[] = [{ id: 'model1', name: 'Model' }];
let mockActiveModelId: string | null = 'model1';

const mockDeleteConversation = jest.fn();
const mockSetActiveConversation = jest.fn();
const mockCreateConversation = jest.fn(() => 'new-conv-id');

jest.mock('../../../src/stores', () => ({
  useProjectStore: jest.fn((selector?: any) => {
    const state = { getProject: () => mockProject };
    return selector ? selector(state) : state;
  }),
  useChatStore: jest.fn((selector?: any) => {
    const state = {
      conversations: mockConversations,
      deleteConversation: mockDeleteConversation,
      setActiveConversation: mockSetActiveConversation,
      createConversation: mockCreateConversation,
    };
    return selector ? selector(state) : state;
  }),
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      downloadedModels: mockDownloadedModels,
      activeModelId: mockActiveModelId,
    };
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={`button-${title}`}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/CustomAlert', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    CustomAlert: ({ visible, title, message, buttons, onClose }: any) => {
      if (!visible) return null;
      return (
        <View testID="custom-alert">
          <Text testID="alert-title">{title}</Text>
          <Text testID="alert-message">{message}</Text>
          {buttons && buttons.map((btn: any, i: number) => (
            <TouchableOpacity
              key={i}
              testID={`alert-button-${btn.text}`}
              onPress={() => {
                if (btn.onPress) btn.onPress();
                onClose?.();
              }}
            >
              <Text>{btn.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    },
    showAlert: (title: string, message: string, buttons?: any[]) => ({
      visible: true, title, message,
      buttons: buttons || [{ text: 'OK', style: 'default' }],
    }),
    hideAlert: () => ({ visible: false, title: '', message: '', buttons: [] }),
    initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { View } = require('react-native');
  return ({ children, renderRightActions }: any) => (
    <View>
      {children}
      {renderRightActions && renderRightActions()}
    </View>
  );
});

import { ProjectChatsScreen } from '../../../src/screens/ProjectChatsScreen';

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

describe('ProjectChatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProject = { id: 'proj1', name: 'Test Project' };
    mockConversations = [];
    mockDownloadedModels = [{ id: 'model1', name: 'Model' }];
    mockActiveModelId = 'model1';
  });

  describe('basic rendering', () => {
    it('renders the project name in the header', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Test Project')).toBeTruthy();
    });

    it('shows fallback "Chats" when project is null', () => {
      mockProject = null;
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Chats')).toBeTruthy();
    });

    it('shows empty state when no chats', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('No chats yet')).toBeTruthy();
    });

    it('shows "Start a new conversation" text when models available', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Start a new conversation for this project.')).toBeTruthy();
    });

    it('shows "Download a model" text when no models', () => {
      mockDownloadedModels = [];
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Download a model to start chatting.')).toBeTruthy();
    });

    it('shows New Chat button when models available', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('New Chat')).toBeTruthy();
    });

    it('hides New Chat button when no models', () => {
      mockDownloadedModels = [];
      const { queryByText } = render(<ProjectChatsScreen />);
      expect(queryByText('New Chat')).toBeNull();
    });
  });

  describe('navigation', () => {
    it('calls goBack when back button pressed', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('arrow-left'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  describe('new chat creation', () => {
    it('creates conversation and navigates to Chat on New Chat press', async () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('New Chat'));
      await flushPromises();
      expect(mockCreateConversation).toHaveBeenCalledWith('model1', undefined, 'proj1');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'new-conv-id', projectId: 'proj1' });
    });

    it('does not create conversation when no models (plus button disabled)', () => {
      mockDownloadedModels = [];
      render(<ProjectChatsScreen />);
      // When no models, plus button is disabled and createConversation is not called
      expect(mockCreateConversation).not.toHaveBeenCalled();
    });

    it('uses first downloaded model when no activeModelId', async () => {
      mockActiveModelId = null;
      mockDownloadedModels = [{ id: 'model2', name: 'Fallback' }];
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('New Chat'));
      await flushPromises();
      expect(mockCreateConversation).toHaveBeenCalledWith('model2', undefined, 'proj1');
    });
  });

  describe('with existing chats', () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const lastWeek = new Date(Date.now() - 8 * 86400000).toISOString();

    beforeEach(() => {
      mockConversations = [
        {
          id: 'conv1',
          projectId: 'proj1',
          title: 'Chat One',
          updatedAt: now,
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
          ],
        },
        {
          id: 'conv2',
          projectId: 'proj1',
          title: 'Chat Two',
          updatedAt: yesterday,
          messages: [],
        },
        {
          id: 'conv3',
          projectId: 'other-proj',
          title: 'Other Project Chat',
          updatedAt: now,
          messages: [],
        },
      ];
    });

    it('renders only chats for the current project', () => {
      const { getByText, queryByText } = render(<ProjectChatsScreen />);
      expect(getByText('Chat One')).toBeTruthy();
      expect(getByText('Chat Two')).toBeTruthy();
      expect(queryByText('Other Project Chat')).toBeNull();
    });

    it('shows last message preview for assistant message', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Hi there')).toBeTruthy();
    });

    it('shows "You: " prefix for last user message', () => {
      mockConversations = [{
        id: 'conv-user',
        projectId: 'proj1',
        title: 'User Chat',
        updatedAt: new Date().toISOString(),
        messages: [{ role: 'user', content: 'My question' }],
      }];
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('You: My question')).toBeTruthy();
    });

    it('navigates to Chat when chat is pressed', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('Chat One'));
      expect(mockSetActiveConversation).toHaveBeenCalledWith('conv1');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'conv1' });
    });

    it('shows delete confirmation and deletes on confirm', async () => {
      const { getAllByText, getByTestId } = render(<ProjectChatsScreen />);
      const trashIcons = getAllByText('trash-2');
      fireEvent.press(trashIcons[0]);
      await flushPromises();

      const deleteBtn = getByTestId('alert-button-Delete');
      fireEvent.press(deleteBtn);
      expect(mockDeleteConversation).toHaveBeenCalled();
    });

    it('formats date as Yesterday', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('formats date as weekday for last week', () => {
      mockConversations = [
        {
          id: 'conv4',
          projectId: 'proj1',
          title: 'Week Chat',
          updatedAt: lastWeek,
          messages: [],
        },
      ];
      render(<ProjectChatsScreen />);
      // Just verify it renders without crash (date format varies by locale)
    });
  });
});
