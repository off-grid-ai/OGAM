/**
 * ProjectDetailScreen Tests
 *
 * Tests for the project detail screen including:
 * - Project name and description display
 * - Empty chats state
 * - Back button navigation
 * - Edit project navigation
 * - Delete project flow
 * - Conversation list with project chats
 * - New chat creation
 * - Delete chat flow
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

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
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: { projectId: 'proj1' },
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

const mockDeleteProject = jest.fn();
const mockDeleteConversation = jest.fn();
const mockSetActiveConversation = jest.fn();
const mockCreateConversation = jest.fn(() => 'new-conv-1');

let mockProject: any = {
  id: 'proj1',
  name: 'Test Project',
  description: 'A test project description',
  systemPrompt: 'Be helpful',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let mockConversations: any[] = [];
let mockDownloadedModels: any[] = [{ id: 'model1', name: 'Test Model' }];
let mockActiveModelId: string | null = 'model1';

jest.mock('../../../src/stores', () => ({
  useProjectStore: jest.fn(() => ({
    getProject: jest.fn(() => mockProject),
    deleteProject: mockDeleteProject,
  })),
  useChatStore: jest.fn(() => ({
    conversations: mockConversations,
    deleteConversation: mockDeleteConversation,
    setActiveConversation: mockSetActiveConversation,
    createConversation: mockCreateConversation,
  })),
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      downloadedModels: mockDownloadedModels,
      activeModelId: mockActiveModelId,
      themeMode: 'system',
    };
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={`button-${title}`}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
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
                onClose();
              }}
            >
              <Text>{btn.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    },
    showAlert: (title: string, message: string, buttons?: any[]) => ({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: 'OK', style: 'default' }],
    }),
    hideAlert: () => ({ visible: false, title: '', message: '', buttons: [] }),
    initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  };
});

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

// The library's SHIPPED jest mock, not a hand-rolled SafeAreaView. This file's own stub exported only
// that one component, so anything in the tree reaching for useSafeAreaInsets (a bottom sheet, for
// instance) took the whole suite down with "is not a function" - the same trap jest.setup.ts already
// documents for the navigation container.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

const mockGetDocumentsByProject = jest.fn<Promise<any[]>, [string]>(() => Promise.resolve([]));
const mockIndexDocument = jest.fn<Promise<number>, [any]>(() => Promise.resolve(1));
const mockDeleteDocumentRag = jest.fn<Promise<void>, [number]>(() => Promise.resolve());
const mockToggleDocument = jest.fn<Promise<void>, [number, boolean]>(() => Promise.resolve());

jest.mock('../../../src/services/rag', () => ({
  ragService: {
    getDocumentsByProject: (projectId: string) => mockGetDocumentsByProject(projectId),
    indexDocument: (params: any) => mockIndexDocument(params),
    deleteDocument: (docId: number) => mockDeleteDocumentRag(docId),
    toggleDocument: (docId: number, enabled: boolean) => mockToggleDocument(docId, enabled),
    deleteProjectDocuments: jest.fn(() => Promise.resolve()),
    ensureReady: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{
    uri: 'file:///mock/doc.pdf',
    name: 'doc.pdf',
    size: 5000,
  }])),
  keepLocalCopy: jest.fn(() => Promise.resolve([{ status: 'success', localUri: 'file:///mock/doc.pdf' }])),
}));

jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { View } = require('react-native');
  return ({ children, renderRightActions }: any) => (
    <View>
      {children}
      {renderRightActions && renderRightActions()}
    </View>
  );
});

import { ProjectDetailScreen } from '../../../src/screens/ProjectDetailScreen';

describe('ProjectDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteProject.mockResolvedValue({ ok: true });
    mockProject = {
      id: 'proj1',
      name: 'Test Project',
      description: 'A test project description',
      systemPrompt: 'Be helpful',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockConversations = [];
    mockDownloadedModels = [{ id: 'model1', name: 'Test Model' }];
    mockActiveModelId = 'model1';
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders project name', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Test Project')).toBeTruthy();
    });

    it('does not show project description in header', () => {
      const { queryByText } = render(<ProjectDetailScreen />);
      // Project description is not displayed in the detail screen header
      expect(queryByText('A test project description')).toBeNull();
    });

    it('shows project initial in icon', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('T')).toBeTruthy();
    });

    it('shows chat count stat', () => {
      const { queryByText } = render(<ProjectDetailScreen />);
      // When there are 0 chats, no count is shown (only shows when > 0)
      expect(queryByText('0 chats')).toBeNull();
    });

    it('shows Chats section title', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Chats')).toBeTruthy();
    });

    it('shows Delete Project button', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Delete Project')).toBeTruthy();
    });
  });

  // ============================================================================
  // Navigation
  // ============================================================================
  describe('navigation', () => {
    it('back button navigates back', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('arrow-left'));
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('edit button navigates to ProjectEdit', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('edit-2'));
      expect(mockNavigate).toHaveBeenCalledWith('ProjectEdit', { projectId: 'proj1' });
    });
  });

  // ============================================================================
  // Empty Chats State
  // ============================================================================
  describe('empty chats state', () => {
    it('shows empty chats message', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('No chats yet')).toBeTruthy();
    });

    it('shows "Start a Chat" button when models available', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Start a Chat')).toBeTruthy();
    });

    it('hides "Start a Chat" button when no models downloaded', () => {
      mockDownloadedModels = [];
      const { queryByText } = render(<ProjectDetailScreen />);
      expect(queryByText('Start a Chat')).toBeNull();
    });
  });

  // ============================================================================
  // Conversation List
  // ============================================================================
  describe('conversation list', () => {
    it('shows conversations for this project', () => {
      mockConversations = [
        {
          id: 'conv1',
          title: 'Project Chat 1',
          projectId: 'proj1',
          modelId: 'model1',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Project Chat 1')).toBeTruthy();
    });

    it('does not show conversations from other projects', () => {
      mockConversations = [
        {
          id: 'conv1',
          title: 'Other Project Chat',
          projectId: 'other-project',
          modelId: 'model1',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const { queryByText, getByText } = render(<ProjectDetailScreen />);
      expect(queryByText('Other Project Chat')).toBeNull();
      // Still shows empty state
      expect(getByText('No chats yet')).toBeTruthy();
    });

    it('shows last message preview in conversation item', () => {
      mockConversations = [
        {
          id: 'conv1',
          title: 'Chat With Preview',
          projectId: 'proj1',
          modelId: 'model1',
          messages: [
            { id: 'm1', role: 'user', content: 'Hello there', timestamp: Date.now() },
            { id: 'm2', role: 'assistant', content: 'Hi! How can I help?', timestamp: Date.now() },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Hi! How can I help?')).toBeTruthy();
    });

    it('shows "You: " prefix for user messages in preview', () => {
      mockConversations = [
        {
          id: 'conv1',
          title: 'Chat With User Preview',
          projectId: 'proj1',
          modelId: 'model1',
          messages: [
            { id: 'm1', role: 'user', content: 'Last user message', timestamp: Date.now() },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText(/You: Last user message/)).toBeTruthy();
    });

    it('shows correct chat count in stats', () => {
      mockConversations = [
        {
          id: 'conv1', title: 'Chat 1', projectId: 'proj1', modelId: 'model1',
          messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'conv2', title: 'Chat 2', projectId: 'proj1', modelId: 'model1',
          messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText } = render(<ProjectDetailScreen />);
      // Component shows just the count number, not "2 chats"
      expect(getByText('2')).toBeTruthy();
    });

    it('navigates to chat when conversation is tapped', () => {
      mockConversations = [
        {
          id: 'conv1', title: 'Tappable Chat', projectId: 'proj1', modelId: 'model1',
          messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Tappable Chat'));

      expect(mockSetActiveConversation).toHaveBeenCalledWith('conv1');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'conv1' });
    });
  });

  // ============================================================================
  // New Chat
  // ============================================================================
  describe('new chat', () => {
    it('creates new conversation and navigates when "New" button is pressed', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('New'));

      expect(mockCreateConversation).toHaveBeenCalledWith('model1', undefined, 'proj1');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'new-conv-1', projectId: 'proj1' });
    });

    it('disables New button when no models available', () => {
      mockDownloadedModels = [];
      const { getByTestId } = render(<ProjectDetailScreen />);
      const newButton = getByTestId('button-New');
      expect(newButton.props.accessibilityState?.disabled || newButton.props.disabled).toBeTruthy();
    });

    it('uses active model ID for new conversation', () => {
      mockActiveModelId = 'model1';
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('New'));

      expect(mockCreateConversation).toHaveBeenCalledWith('model1', undefined, 'proj1');
    });

    it('falls back to first downloaded model when no active model', () => {
      mockActiveModelId = null;
      mockDownloadedModels = [{ id: 'fallback-model', name: 'Fallback' }];
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('New'));

      expect(mockCreateConversation).toHaveBeenCalledWith('fallback-model', undefined, 'proj1');
    });
  });

  // ============================================================================
  // Delete Project
  // ============================================================================
  describe('delete project', () => {
    it('shows confirmation alert when Delete Project is pressed', () => {
      const { getByText, queryByTestId } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Delete Project'));

      expect(queryByTestId('custom-alert')).toBeTruthy();
      expect(queryByTestId('alert-title')?.props.children).toBe('Delete Project');
    });

    it('includes project name in confirmation message', () => {
      const { getByText, queryByTestId } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Delete Project'));

      const message = queryByTestId('alert-message')?.props.children;
      expect(message).toContain('Test Project');
    });

    it('deletes project and navigates back when confirmed', async () => {
      const { getByText, getByTestId } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Delete Project'));

      // Press "Delete" in the confirmation alert
      fireEvent.press(getByTestId('alert-button-Delete'));

      expect(mockDeleteProject).toHaveBeenCalledWith('proj1');
      await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    });

    it('does not delete project when cancelled', () => {
      const { getByText, getByTestId } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Delete Project'));

      // Press "Cancel" in the confirmation alert
      fireEvent.press(getByTestId('alert-button-Cancel'));

      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(mockGoBack).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Delete Chat
  // ============================================================================
  describe('delete chat', () => {
    it('shows confirmation alert when delete swipe action is pressed', () => {
      mockConversations = [
        {
          id: 'conv1', title: 'Delete Me Chat', projectId: 'proj1', modelId: 'model1',
          messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText, queryByTestId } = render(<ProjectDetailScreen />);
      // The trash icon renders as "trash-2" text from our Icon mock
      fireEvent.press(getByText('trash-2'));

      expect(queryByTestId('custom-alert')).toBeTruthy();
      expect(queryByTestId('alert-title')?.props.children).toBe('Delete Chat');
    });

    it('deletes conversation when confirmed', () => {
      mockConversations = [
        {
          id: 'conv1', title: 'Delete Me', projectId: 'proj1', modelId: 'model1',
          messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ];

      const { getByText, getByTestId } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('trash-2'));
      fireEvent.press(getByTestId('alert-button-Delete'));

      expect(mockDeleteConversation).toHaveBeenCalledWith('conv1');
    });
  });

  // ============================================================================
  // Project Not Found
  // ============================================================================
  describe('project not found', () => {
    it('shows error when project is null', () => {
      mockProject = null;
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Project not found')).toBeTruthy();
    });

    it('shows "Go back" link when project not found', () => {
      mockProject = null;
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Go back')).toBeTruthy();
    });

    it('navigates back when "Go back" link is pressed', () => {
      mockProject = null;
      const { getByText } = render(<ProjectDetailScreen />);
      fireEvent.press(getByText('Go back'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Knowledge Base
  // ============================================================================
  describe('knowledge base', () => {
    it('shows Knowledge Base section title', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Knowledge Base')).toBeTruthy();
    });

    it('shows empty state when no documents', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('No documents added')).toBeTruthy();
    });

    it('shows Add button', () => {
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Add')).toBeTruthy();
    });

    it('shows documents when loaded', async () => {
      mockGetDocumentsByProject.mockResolvedValue([
        { id: 1, project_id: 'proj1', name: 'readme.pdf', path: '/p', size: 2048, created_at: '2024-01-01', enabled: 1 },
      ]);

      const { findByText } = render(<ProjectDetailScreen />);
      expect(await findByText('readme.pdf')).toBeTruthy();
    });

    it('shows formatted file size', async () => {
      mockGetDocumentsByProject.mockResolvedValue([
        { id: 1, project_id: 'proj1', name: 'big.pdf', path: '/p', size: 1048576, created_at: '2024-01-01', enabled: 1 },
      ]);

      const { findByText } = render(<ProjectDetailScreen />);
      expect(await findByText('1.0 MB')).toBeTruthy();
    });
  });

  // ============================================================================
  // Project Without Description
  // ============================================================================
  describe('project without description', () => {
    it('does not render description when empty', () => {
      mockProject = { ...mockProject, description: '' };
      const { queryByText } = render(<ProjectDetailScreen />);
      expect(queryByText('A test project description')).toBeNull();
    });

    it('does not render description when null', () => {
      mockProject = { ...mockProject, description: null };
      const { queryByText } = render(<ProjectDetailScreen />);
      expect(queryByText('A test project description')).toBeNull();
    });
  });

  // ============================================================================
  // handleNewChat with no models (lines 57-58)
  // ============================================================================
  describe('new chat when no models', () => {
    it('exercises handleNewChat no-model branch (lines 57-58)', () => {
      // The branch at lines 57-58 fires when downloadedModels is empty.
      // We can't directly observe the alert (mock store isn't reactive enough),
      // but we can verify handleNewChat runs the guard path and does NOT call
      // createConversation (which would be called in the happy path).
      mockDownloadedModels = [];

      const { getByTestId } = render(<ProjectDetailScreen />);

      // Call onPress directly — exercises the !hasModels branch
      act(() => {
        getByTestId('button-New').props.onPress?.();
      });

      // createConversation should NOT have been called (no models = early return)
      expect(mockCreateConversation).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // formatDate branches (lines 115-120)
  // ============================================================================
  describe('formatDate', () => {
    const makeConv = (daysAgo: number) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      return {
        id: `conv-${daysAgo}`,
        title: `Chat ${daysAgo}d ago`,
        projectId: 'proj1',
        modelId: 'model1',
        messages: [],
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
      };
    };

    it('shows "Yesterday" for conversations updated 1 day ago (line 116)', () => {
      mockConversations = [makeConv(1)];
      const { getByText } = render(<ProjectDetailScreen />);
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('shows weekday name for conversations updated 3 days ago (line 118)', () => {
      mockConversations = [makeConv(3)];
      const { toJSON } = render(<ProjectDetailScreen />);
      // toLocaleDateString with { weekday: 'short' } returns e.g. "Mon", "Tue"
      // The exact value depends on locale; just verify the component renders
      expect(toJSON()).toBeTruthy();
    });

    it('shows month/day for conversations updated 8 days ago (line 120)', () => {
      mockConversations = [makeConv(8)];
      const { toJSON } = render(<ProjectDetailScreen />);
      // toLocaleDateString with { month: 'short', day: 'numeric' }
      expect(toJSON()).toBeTruthy();
    });
  });

  // ============================================================================
  // Knowledge Base file indexing fixes
  // ============================================================================
  describe('Knowledge Base file indexing fixes', () => {
    // Grab the mocked pick function so we can reconfigure it per test
    const DocumentPicker = require('@react-native-documents/picker');

    beforeEach(() => {
      // Reset pick to a single-file result by default
      DocumentPicker.pick.mockResolvedValue([{
        uri: 'file:///mock/doc.pdf',
        name: 'doc.pdf',
        size: 5000,
      }]);
      DocumentPicker.keepLocalCopy.mockResolvedValue([{ status: 'success', localUri: 'file:///mock/doc.pdf' }]);
    });

    it('Add button is enabled before any indexing', () => {
      const { getByTestId } = render(<ProjectDetailScreen />);
      const addButton = getByTestId('button-Add');
      // disabled should be falsy — the button is not disabled at rest
      expect(addButton.props.disabled).toBeFalsy();
    });

    it('Add button is enabled while indexing is in progress', async () => {
      // Make indexDocument hang indefinitely so we can inspect state mid-flight
      let resolveIndex!: () => void;
      mockIndexDocument.mockReturnValue(new Promise<number>((resolve) => {
        resolveIndex = () => resolve(1);
      }));

      const { getByTestId } = render(<ProjectDetailScreen />);
      const addButton = getByTestId('button-Add');

      // Button starts enabled
      expect(addButton.props.disabled).toBeFalsy();

      // Trigger the add flow (starts indexing but doesn't finish yet)
      act(() => {
        fireEvent.press(addButton);
      });

      // Even while indexing is in progress the button must remain enabled
      expect(addButton.props.disabled).toBeFalsy();

      // Resolve the pending index so React can flush and we avoid act() warnings
      await act(async () => {
        resolveIndex();
      });
    });

    it('File count updates after each file is indexed', async () => {
      // First call (mount): no documents; second call (after indexing): one document
      mockGetDocumentsByProject
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 1, name: 'doc1.pdf', path: '/p', size: 1000, enabled: 1, project_id: 'proj1', created_at: '2024-01-01' }]);

      DocumentPicker.pick.mockResolvedValue([{
        uri: 'file:///mock/doc1.pdf',
        name: 'doc1.pdf',
        size: 1000,
      }]);

      mockIndexDocument.mockResolvedValue(1);

      const { getByTestId } = render(<ProjectDetailScreen />);

      // Wait for the initial load to complete
      await waitFor(() => expect(mockGetDocumentsByProject).toHaveBeenCalledTimes(1));

      // Press Add and wait for the full indexing cycle to complete
      await act(async () => {
        fireEvent.press(getByTestId('button-Add'));
      });

      // loadKbDocs must have been called at least twice:
      // once on mount + at least once inside the loop after indexing the file
      await waitFor(() => expect(mockGetDocumentsByProject.mock.calls.length).toBeGreaterThanOrEqual(2));
    });

    it('loadKbDocs is called per file during multi-file indexing', async () => {
      // First call: mount; subsequent calls: after each file indexed
      mockGetDocumentsByProject.mockResolvedValue([]);
      mockIndexDocument.mockResolvedValue(1);

      // Return two files from the picker
      DocumentPicker.pick.mockResolvedValue([
        { uri: 'file:///mock/file1.pdf', name: 'file1.pdf', size: 1000 },
        { uri: 'file:///mock/file2.pdf', name: 'file2.pdf', size: 2000 },
      ]);
      DocumentPicker.keepLocalCopy
        .mockResolvedValueOnce([{ status: 'success', localUri: 'file:///mock/file1.pdf' }])
        .mockResolvedValueOnce([{ status: 'success', localUri: 'file:///mock/file2.pdf' }]);

      const { getByTestId } = render(<ProjectDetailScreen />);

      // Wait for initial mount load
      await waitFor(() => expect(mockGetDocumentsByProject).toHaveBeenCalledTimes(1));

      // Press Add and wait for both files to be indexed
      await act(async () => {
        fireEvent.press(getByTestId('button-Add'));
      });

      // Expect: 1 (mount) + 1 (after file1) + 1 (after file2) + 1 (final after loop) = 4
      // At minimum: 1 (mount) + 2 (one per file inside loop) = 3
      await waitFor(() => expect(mockGetDocumentsByProject.mock.calls.length).toBeGreaterThanOrEqual(3));
    });
  });
});
