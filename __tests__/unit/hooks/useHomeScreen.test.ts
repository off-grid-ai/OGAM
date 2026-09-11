/**
 * useHomeScreen Hook Unit Tests
 *
 * Tests for the HomeScreen orchestration hook covering:
 * - startNewChat / continueChat navigation
 * - handleDeleteConversation alert flow
 * - handleEjectAll (no-op, success, remote, error)
 * - handleSelectRemoteTextModel / handleUnloadRemoteTextModel
 * - handleSelectRemoteImageModel / handleUnloadRemoteImageModel
 * - activeTextModel / activeImageModel computation
 * - remoteTextModels / remoteImageModels filtering
 */

import { renderHook, act } from '@testing-library/react-native';

// ============================================================================
// Service mocks
// ============================================================================
// useActiveTextModel imports the service module directly, so mocking only the barrel left the real
// service reading the real store while this suite drove a mocked one.
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
  },
}));

jest.mock('../../../src/services', () => ({
  modelManager: {
    getDownloadedModels: jest.fn().mockResolvedValue([]),
    getDownloadedImageModels: jest.fn().mockResolvedValue([]),
    linkOrphanMmProj: jest.fn().mockResolvedValue(undefined),
  },
  hardwareService: {
    getDeviceInfo: jest.fn().mockResolvedValue({ deviceName: 'TestPhone' }),
  },
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
    syncWithNativeState: jest.fn(),
    getResourceUsage: jest.fn().mockResolvedValue({ totalMemory: 8000, usedMemory: 2000, availableMemory: 6000 }),
    subscribe: jest.fn(() => jest.fn()),
    unloadAllModels: jest.fn().mockResolvedValue({ textUnloaded: true, imageUnloaded: false }),
  },
  remoteServerManager: {
    setActiveRemoteTextModel: jest.fn().mockResolvedValue(undefined),
    setActiveRemoteMediaModel: jest.fn().mockResolvedValue(undefined),
    clearActiveRemoteTextModel: jest.fn(),
    clearActiveRemoteMediaModel: jest.fn(),
    addServer: jest.fn().mockResolvedValue({ id: 'mock-id', name: 'mock', endpoint: 'http://mock' }),
    updateServer: jest.fn().mockResolvedValue(undefined),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
  },
  ResourceUsage: {},
}));

jest.mock('../../../src/screens/HomeScreen/hooks/useModelLoading', () => ({
  useModelLoading: jest.fn(() => ({
    handleSelectTextModel: jest.fn(),
    handleUnloadTextModel: jest.fn(),
    handleSelectImageModel: jest.fn(),
    handleUnloadImageModel: jest.fn(),
  })),
}));

jest.mock('../../../src/components', () => ({
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  showAlert: jest.fn((title, message, buttons) => ({ visible: true, title, message, buttons: buttons || [] })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

// ============================================================================
// Store mocks
// ============================================================================
const mockCreateConversation = jest.fn(() => 'conv-new');
const mockSetActiveConversation = jest.fn();
const mockDeleteConversation = jest.fn();

jest.mock('../../../src/stores', () => {
  const appState = {
    downloadedModels: [],
    setDownloadedModels: jest.fn(),
    activeModelId: null,
    setActiveModelId: jest.fn(),
    downloadedImageModels: [],
    setDownloadedImageModels: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    deviceInfo: { deviceName: 'TestPhone' },
    setDeviceInfo: jest.fn(),
    generatedImages: [],
    settings: { contextLength: 4096 },
    updateSettings: jest.fn(),
  };
  const remoteState = {
    servers: [] as any[],
    discoveredModels: {},
    activeRemoteTextModelId: null,
    activeRemoteImageModelId: null,
    activeServerId: null,
    activeRemoteMediaServerIds: { text: null, image: null },
  };
  const useAppStore: any = jest.fn((selector?: any) => (selector ? selector(appState) : appState));
  useAppStore.getState = () => appState;
  const useRemoteServerStore: any = jest.fn((selector?: any) => (selector ? selector(remoteState) : remoteState));
  useRemoteServerStore.getState = () => remoteState;
  return {
    useAppStore,
    useChatStore: jest.fn(() => ({
      conversations: [],
      createConversation: mockCreateConversation,
      setActiveConversation: mockSetActiveConversation,
      deleteConversation: mockDeleteConversation,
    })),
    useRemoteServerStore,
  };
});

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { useHomeScreen } from '../../../src/screens/HomeScreen/hooks/useHomeScreen';
import { remoteServerManager } from '../../../src/services';
import { useAppStore, useChatStore, useRemoteServerStore } from '../../../src/stores';
import { showAlert, hideAlert } from '../../../src/components';

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate } as any;

describe('useHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRemoteServerStore as unknown as jest.Mock).mockImplementation((selector?: any) => {
      const state = {
        servers: [],
        discoveredModels: {},
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        activeServerId: null,
        activeRemoteMediaServerIds: { text: null, image: null },
      };
      return selector ? selector(state) : state;
    });
    (useChatStore as unknown as jest.Mock).mockReturnValue({
      conversations: [],
      createConversation: mockCreateConversation,
      setActiveConversation: mockSetActiveConversation,
      deleteConversation: mockDeleteConversation,
    });
    (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => {
      const st = {
        downloadedModels: [],
        setDownloadedModels: jest.fn(),
        activeModelId: null,
        setActiveModelId: jest.fn(),
        downloadedImageModels: [],
        setDownloadedImageModels: jest.fn(),
        activeImageModelId: null,
        setActiveImageModelId: jest.fn(),
        deviceInfo: { deviceName: 'TestPhone' },
        setDeviceInfo: jest.fn(),
        generatedImages: [],
        settings: { contextLength: 4096 },
      };
      return sel ? sel(st) : st;
    });
  });

  // ==========================================================================
  // Navigation
  // ==========================================================================
  describe('startNewChat', () => {
    it('does nothing when no active model', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('creates conversation and navigates when local model is active', () => {
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [{ id: 'local-model-1', name: 'Local' }], setDownloadedModels: jest.fn(),
        activeModelId: 'local-model-1', setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });

    it('uses remote text model id when no local model is active', () => {
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [], discoveredModels: { 'server-1': [{ id: 'remote-model-1', name: 'Remote' }] },
        activeRemoteTextModelId: 'remote-model-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
        activeRemoteMediaServerIds: { text: 'server-1', image: null },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });
  });

  describe('continueChat', () => {
    it('sets active conversation and navigates', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.continueChat('conv-123'); });
      expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-123');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'conv-123' });
    });
  });

  // ==========================================================================
  // handleDeleteConversation
  // ==========================================================================
  describe('handleDeleteConversation', () => {
    it('shows delete confirmation alert', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const conversation = { id: 'conv-1', title: 'My Chat' } as any;
      act(() => { result.current.handleDeleteConversation(conversation); });
      expect(showAlert).toHaveBeenCalledWith(
        'Delete Conversation',
        expect.stringContaining('My Chat'),
        expect.any(Array),
      );
    });

    it('deletes conversation when confirmed', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const conversation = { id: 'conv-1', title: 'My Chat' } as any;
      act(() => { result.current.handleDeleteConversation(conversation); });
      const buttons = (showAlert as jest.Mock).mock.calls[0][2];
      const deleteBtn = buttons.find((b: any) => b.text === 'Delete');
      act(() => { deleteBtn.onPress(); });
      expect(mockDeleteConversation).toHaveBeenCalledWith('conv-1');
      expect(hideAlert).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleEjectAll
  // ==========================================================================
  describe('handleEjectAll', () => {
    it('does nothing when no active models', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).not.toHaveBeenCalled();
    });

    it('shows eject confirmation when local model is active', () => {
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [], setDownloadedModels: jest.fn(),
        activeModelId: 'model-1', setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).toHaveBeenCalledWith(
        'Eject All Models',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Eject All' }),
        ]),
      );
    });

    it('shows eject confirmation when remote model is active', () => {
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [], discoveredModels: {},
        activeRemoteTextModelId: 'remote-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
        activeRemoteMediaServerIds: { text: 'server-1', image: null },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).toHaveBeenCalledWith('Eject All Models', expect.any(String), expect.any(Array));
    });
  });

  // ==========================================================================
  // Remote model handlers
  // ==========================================================================
  describe('handleSelectRemoteTextModel', () => {
    it('calls setActiveRemoteTextModel and clears loading state', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'remote-1', serverId: 'server-1', name: 'Remote Llama', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteTextModel(model); });
      expect(remoteServerManager.setActiveRemoteTextModel).toHaveBeenCalledWith('server-1', 'remote-1');
      expect(result.current.loadingState.isLoading).toBe(false);
    });

    it('shows error alert when setActiveRemoteTextModel fails', async () => {
      (remoteServerManager.setActiveRemoteTextModel as jest.Mock).mockRejectedValueOnce(
        new Error('Server offline'),
      );
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'r1', serverId: 's1', name: 'Model', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteTextModel(model); });
      expect(showAlert).toHaveBeenCalledWith('Error', expect.stringContaining('Server offline'));
    });
  });

  describe('handleUnloadRemoteTextModel', () => {
    it('calls clearActiveRemoteModel', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteTextModel(); });
      expect(remoteServerManager.clearActiveRemoteTextModel).toHaveBeenCalled();
    });
  });

  describe('handleSelectRemoteImageModel', () => {
    it('calls setActiveRemoteImageModel', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'img-1', serverId: 'server-1', name: 'Vision Model', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteImageModel(model); });
      expect(remoteServerManager.setActiveRemoteMediaModel).toHaveBeenCalledWith('server-1', 'image', 'img-1');
    });

    it('shows error alert when setActiveRemoteImageModel fails', async () => {
      (remoteServerManager.setActiveRemoteMediaModel as jest.Mock).mockRejectedValueOnce(
        new Error('Vision unavailable'),
      );
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'img-1', serverId: 'server-1', name: 'Vision', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteImageModel(model); });
      expect(showAlert).toHaveBeenCalledWith('Error', expect.stringContaining('Vision unavailable'));
    });
  });

  describe('handleUnloadRemoteImageModel', () => {
    it('calls clearActiveRemoteModel', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteImageModel(); });
      expect(remoteServerManager.clearActiveRemoteMediaModel).toHaveBeenCalledWith('image');
    });
  });

  // ==========================================================================
  // Computed values
  // ==========================================================================
  describe('activeTextModel computation', () => {
    it('returns local model when active', () => {
      const localModel = { id: 'local-1', name: 'Local Llama' } as any;
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [localModel],
        setDownloadedModels: jest.fn(),
        activeModelId: 'local-1',
        setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toEqual(localModel);
    });

    it('returns remote text model when no local model', () => {
      const remoteModel = { id: 'remote-1', serverId: 'server-1', name: 'Remote', capabilities: { supportsVision: false } } as any;
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{
          id: 'server-1',
          name: 'Office Mac',
          modelCatalog: { image: [{ id: 'img-remote-1', name: 'Vision' }] },
        }],
        discoveredModels: { 'server-1': [remoteModel] },
        activeRemoteTextModelId: 'remote-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
        activeRemoteMediaServerIds: { text: 'server-1', image: null },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toEqual(remoteModel);
    });

    it('returns null when no active model', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toBeNull();
    });
  });


  // ==========================================================================
  // Error paths in unload handlers
  // ==========================================================================
  describe('handleUnloadRemoteTextModel error path', () => {
    it('shows error alert when clearActiveRemoteModel throws', async () => {
      (remoteServerManager.clearActiveRemoteTextModel as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Clear failed');
      });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteTextModel(); });
      expect(showAlert).toHaveBeenCalledWith('Error', 'Failed to disconnect remote model');
    });
  });

  describe('handleUnloadRemoteImageModel error path', () => {
    it('shows error alert when clearActiveRemoteModel throws', async () => {
      (remoteServerManager.clearActiveRemoteMediaModel as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Clear failed');
      });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteImageModel(); });
      expect(showAlert).toHaveBeenCalledWith('Error', 'Failed to disconnect remote model');
    });
  });

  // ==========================================================================
  // activeRemoteImageModel computation
  // ==========================================================================
  describe('activeImageModel computation with remote image model', () => {
    it('returns remote image model when active', () => {
      const remoteImgModel = { id: 'img-remote-1', serverId: 'server-1', name: 'Vision', capabilities: { supportsVision: true } } as any;
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{
          id: 'server-1',
          name: 'Office Mac',
          modelCatalog: { image: [{ id: 'img-remote-1', name: 'Vision' }] },
        }],
        discoveredModels: { 'server-1': [remoteImgModel] },
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: 'img-remote-1',
        activeServerId: 'server-1',
        activeRemoteMediaServerIds: { text: null, image: 'server-1' },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeImageModel).toEqual(expect.objectContaining({
        id: remoteImgModel.id,
        name: remoteImgModel.name,
        serverId: remoteImgModel.serverId,
      }));
    });
  });

  describe('remoteTextModels / remoteImageModels filtering', () => {
    it('includes all remote models (including VL) in remoteTextModels', () => {
      const textModel = { id: 't1', serverId: 's1', name: 'Text', capabilities: { supportsVision: false } } as any;
      const vlModel = { id: 'i1', serverId: 's1', name: 'Vision', capabilities: { supportsVision: true } } as any;
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{ id: 's1' }],
        discoveredModels: { s1: [textModel, vlModel] },
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        activeServerId: null,
        activeRemoteMediaServerIds: { text: null, image: null },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      // All remote models (including VL) go into remoteTextModels — remote image gen not supported
      expect(result.current.remoteTextModels).toEqual([textModel, vlModel]);
      expect(result.current.remoteImageModels).toEqual([]);
    });

    it('returns empty arrays when no servers', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.remoteTextModels).toEqual([]);
      expect(result.current.remoteImageModels).toEqual([]);
    });
  });
});
