/**
 * ModelDownloadScreen Tests
 *
 * Tests for the model download screen including:
 * - Screen rendering (loading state)
 * - Loaded state with recommended models
 * - Skip button
 * - Download flow (foreground and background)
 * - Error handling
 * - Warning card for limited compatibility
 * - Network section integration (scan, connect, add server)
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      replace: mockReplace,
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

const mockAppState = {
  downloadedModels: [],
  settings: {},
  deviceInfo: { deviceModel: 'Test Device', availableMemory: 8000000000 },
  setDeviceInfo: jest.fn(),
  setModelRecommendation: jest.fn(),
  downloadProgress: {} as Record<string, any>,
  setDownloadProgress: jest.fn(),
  addDownloadedModel: jest.fn(),
  setActiveModelId: jest.fn(),
  themeMode: 'system',
};

jest.mock('../../../src/stores', () => ({
  useAppStore: Object.assign(
    jest.fn((selector?: any) => (selector ? selector(mockAppState) : mockAppState)),
    // startModelDownload (the shared download action) reads useAppStore.getState().
    { getState: () => mockAppState },
  ),
}));

const mockRemoteServerState = {
  servers: [] as any[],
  discoveredModels: {} as Record<string, any[]>,
  testConnection: jest.fn().mockResolvedValue({ success: false }),
};

jest.mock('../../../src/stores/remoteServerStore', () => ({
  useRemoteServerStore: Object.assign(
    jest.fn((selector?: any) => {
      return selector ? selector(mockRemoteServerState) : mockRemoteServerState;
    }),
    {
      getState: jest.fn(() => mockRemoteServerState),
    },
  ),
}));

const mockGetModelFiles = jest.fn<Promise<any[]>, any[]>(() => Promise.resolve([]));
const mockDownloadModel = jest.fn();
const mockDownloadModelBackground = jest.fn();

jest.mock('../../../src/services', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({ deviceModel: 'Test Device', availableMemory: 8000000000 })),
    getModelRecommendation: jest.fn(() => ({ tier: 'medium' })),
    getTotalMemoryGB: jest.fn(() => 8),
    formatBytes: jest.fn((bytes: number) => `${(bytes / 1e9).toFixed(1)}GB`),
  },
  huggingFaceService: {
    getModelFiles: jest.fn((...args: any[]) => (mockGetModelFiles as any)(...args)),
  },
  modelManager: {
    isBackgroundDownloadSupported: jest.fn(() => false),
    downloadModel: jest.fn((...args: any[]) => mockDownloadModel(...args)),
    downloadModelBackground: jest.fn((...args: any[]) => mockDownloadModelBackground(...args)),
    watchDownload: jest.fn(),
  },
  remoteServerManager: {
    addServer: jest.fn().mockResolvedValue({ id: 'new-server' }),
    testConnection: jest.fn().mockResolvedValue({ success: false }),
    setActiveRemoteTextModel: jest.fn().mockResolvedValue(undefined),
  },
}));

// The shared startModelDownload action imports modelManager from the direct module,
// not the barrel — point it at the same mock so the screen's delegation is exercised.
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: jest.requireMock('../../../src/services').modelManager,
}));

jest.mock('../../../src/services/networkDiscovery', () => ({
  discoverLANServers: jest.fn().mockResolvedValue([]),
}));

const { hardwareService: mockHardwareService, modelManager: mockModelManager, huggingFaceService: mockHuggingFaceService } = jest.requireMock('../../../src/services');

jest.mock('../../../src/components/CustomAlert', () =>
  require('../../helpers/mockCustomAlert').customAlertMock,
);
const { mockShowAlert } = require('../../helpers/mockCustomAlert');

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
  ModelCard: ({ model, onPress, onDownload, testID, _file, isDownloading }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID={testID}>
        <Text>{model?.name || 'ModelCard'}</Text>
        {onPress && (
          <TouchableOpacity testID={`${testID}-press`} onPress={onPress}>
            <Text>Select</Text>
          </TouchableOpacity>
        )}
        {onDownload && (
          <TouchableOpacity testID={`${testID}-download`} onPress={onDownload}>
            <Text>Download</Text>
          </TouchableOpacity>
        )}
        {isDownloading && <Text testID={`${testID}-downloading`}>Downloading...</Text>}
      </View>
    );
  },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled, testID }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/RemoteServerModal', () => ({
  RemoteServerModal: ({ visible }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return <View testID="remote-server-modal"><Text>Add Remote Server</Text></View>;
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const { View } = require('react-native');
    return <View {...props}>{children}</View>;
  },
}));

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

// Mock the NetworkSection component to simplify screen-level tests
const mockOnScanNetwork = jest.fn();
const mockOnAddManually = jest.fn();
const mockOnConnectServer = jest.fn();
jest.mock('../../../src/screens/ModelDownloadHelpers', () => {
  const actual = jest.requireActual('../../../src/screens/ModelDownloadHelpers');
  return {
    ...actual,
    NetworkSection: ({ onScanNetwork, onAddManually, onConnectServer, servers, isCheckingNetwork, isScanning }: any) => {
      const { View, Text, TouchableOpacity } = require('react-native');
      // Store refs so tests can call them
      mockOnScanNetwork.mockImplementation(onScanNetwork);
      mockOnAddManually.mockImplementation(onAddManually);
      mockOnConnectServer.mockImplementation(onConnectServer);
      return (
        <View testID="network-section">
          <Text>Network Models</Text>
          {isCheckingNetwork && <Text testID="network-checking">Scanning...</Text>}
          {isScanning && <Text testID="network-scanning">Scanning network...</Text>}
          {servers && servers.map((s: any) => (
            <TouchableOpacity key={s.id} testID={`connect-server-${s.id}`} onPress={() => onConnectServer(s)}>
              <Text testID={`network-server-${s.id}`}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity testID="scan-network-btn" onPress={onScanNetwork}>
            <Text>Scan Network</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="add-server-btn" onPress={onAddManually}>
            <Text>Add Server</Text>
          </TouchableOpacity>
        </View>
      );
    },
  };
});

import { Platform } from 'react-native';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { ModelDownloadScreen } from '../../../src/screens/ModelDownloadScreen';
import { LITERT_PARENT_ID } from '../../../src/services/curatedLiteRTRegistry';

const MOCK_FILE = {
  name: 'model-Q4_K_M.gguf',
  size: 4000000000,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://example.com/model.gguf',
};

const mockNavigation: any = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  replace: mockReplace,
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};

async function flushPromises(count = 10) {
  for (let i = 0; i < count; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

describe('ModelDownloadScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // startModelDownload publishes a real queued row to the (real) downloadStore; reset it
    // so a pending row from one test doesn't trip the next test's duplicate-start guard.
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
    mockAppState.downloadProgress = {};
    mockRemoteServerState.servers = [];
    mockRemoteServerState.discoveredModels = {};
    mockRemoteServerState.testConnection.mockResolvedValue({ success: false });
    mockGetModelFiles.mockResolvedValue([]);
    mockDownloadModel.mockResolvedValue(undefined);
    mockDownloadModelBackground.mockResolvedValue(undefined);
    mockHardwareService.getDeviceInfo.mockResolvedValue({ deviceModel: 'Test Device', availableMemory: 8000000000 });
    mockHardwareService.getModelRecommendation.mockReturnValue({ tier: 'medium' });
    mockHardwareService.getTotalMemoryGB.mockReturnValue(8);
    mockHardwareService.formatBytes.mockImplementation((bytes: number) => `${(bytes / 1e9).toFixed(1)}GB`);
    mockModelManager.isBackgroundDownloadSupported.mockReturnValue(true);
    mockModelManager.downloadModel.mockImplementation((...args: any[]) => (mockDownloadModel as any)(...args));
    mockModelManager.downloadModelBackground.mockImplementation((...args: any[]) => (mockDownloadModelBackground as any)(...args));
    mockHuggingFaceService.getModelFiles.mockImplementation((...args: any[]) => (mockGetModelFiles as any)(...args));
  });

  // ===========================================================================
  // Loading state
  // ===========================================================================
  it('renders the loading state initially', () => {
    const { getByText } = render(
      <ModelDownloadScreen navigation={mockNavigation} />,
    );
    expect(getByText(/Analyzing your device/)).toBeTruthy();
  });

  it('renders with testID for loading state', () => {
    const { getByTestId } = render(
      <ModelDownloadScreen navigation={mockNavigation} />,
    );
    expect(getByTestId('model-download-loading')).toBeTruthy();
  });

  // ===========================================================================
  // Loaded state
  // ===========================================================================
  it('renders the loaded state with "Set Up Your AI" title', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByTestId('model-download-screen')).toBeTruthy();
    expect(result.getByText('Set Up Your AI')).toBeTruthy();
    expect(result.getByText(/Connect to a model server/)).toBeTruthy();
  });

  it('renders device info card after loading', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByText('Your Device')).toBeTruthy();
    expect(result.getByText('Test Device')).toBeTruthy();
    expect(result.getByText('Available Memory')).toBeTruthy();
  });

  it('renders the NetworkSection', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByTestId('network-section')).toBeTruthy();
    expect(result.getByText('Network Models')).toBeTruthy();
  });

  it('renders "Download to Your Device" section title', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByText('Download to Your Device')).toBeTruthy();
  });

  // ===========================================================================
  // Skip button
  // ===========================================================================
  it('skip button navigates to Main', async () => {
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const skipButton = result.getByTestId('model-download-skip');
    fireEvent.press(skipButton);
    expect(mockReplace).toHaveBeenCalledWith('Main');
  });

  // ===========================================================================
  // Model rendering + download
  // ===========================================================================
  it('renders recommended models based on device RAM', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByTestId('recommended-model-0')).toBeTruthy();
  });

  it('shows warning card when no compatible models', async () => {
    mockHardwareService.getTotalMemoryGB.mockReturnValue(1);

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    expect(result.getByText('Limited Compatibility')).toBeTruthy();
  });

  it('download button triggers handleDownload via background download', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 1 });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);

    const downloadBtn = await result.findByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockDownloadModelBackground).toHaveBeenCalled();
  });

  it('download button triggers background download when supported', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    mockModelManager.isBackgroundDownloadSupported.mockReturnValue(true);
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 123 });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const downloadBtn = await result.findByTestId('recommended-model-0-download', {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockDownloadModelBackground).toHaveBeenCalled();
  }, 20000);

  async function setupDownloadCompletion() {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);
    const completedModel = {
      id: 'test-model', name: 'Test Model', author: 'test',
      fileName: 'model-Q4_K_M.gguf', filePath: '/path',
      fileSize: 4000000000, quantization: 'Q4_K_M',
      downloadedAt: new Date().toISOString(),
    };
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 42 });
    let capturedOnComplete: ((model: any) => void) | undefined;
    mockModelManager.watchDownload.mockImplementation((_id: number, onComplete: any) => {
      capturedOnComplete = onComplete;
    });
    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();
    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => { fireEvent.press(downloadBtn); });
    await act(async () => { capturedOnComplete?.(completedModel); });
    return { result, completedModel };
  }

  it('download calls onComplete callback and marks model as downloaded', async () => {
    const { completedModel } = await setupDownloadCompletion();

    expect(mockAppState.addDownloadedModel).toHaveBeenCalledWith(completedModel);
    // No alert on completion — success is shown via the tick on the card
    expect(mockShowAlert).not.toHaveBeenCalledWith(
      'Download Complete!',
      expect.anything(),
      expect.anything(),
    );
  });

  it('download calls onError callback and shows error alert', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    mockDownloadModelBackground.mockResolvedValue({ downloadId: 42 });
    let capturedOnError: ((err: Error) => void) | undefined;
    mockModelManager.watchDownload.mockImplementation((_id: number, _onComplete: any, onError: any) => {
      capturedOnError = onError;
    });

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    await act(async () => {
      capturedOnError?.(new Error('Download failed'));
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Download Failed', 'Download failed');
  });

  it('download catch block shows error on exception', async () => {
    mockGetModelFiles.mockResolvedValue([MOCK_FILE]);

    mockDownloadModelBackground.mockRejectedValue(new Error('Unexpected error'));

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const downloadBtn = result.getByTestId('recommended-model-0-download');
    await act(async () => {
      fireEvent.press(downloadBtn);
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Download Failed', 'Unexpected error');
  });

  it('init error shows error alert', async () => {
    mockHardwareService.getDeviceInfo.mockRejectedValueOnce(new Error('Hardware error'));

    render(<ModelDownloadScreen navigation={mockNavigation} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Failed to initialize. Please try again.');
  });

  // ===========================================================================
  // handleConnectServer
  // ===========================================================================

  const MOCK_SERVER = { id: 'srv-1', name: 'My Server', endpoint: 'http://192.168.1.10:11434', providerType: 'openai-compatible' as const };

  it('handleConnectServer — success with models shows connected alert and sets active model', async () => {
    const { remoteServerManager: mockRsm } = jest.requireMock('../../../src/services');
    const mockModels = [
      { id: 'llama3', capabilities: { supportsVision: false } },
      { id: 'llava', capabilities: { supportsVision: true } },
    ];
    mockRsm.testConnection.mockResolvedValueOnce({ success: true, models: mockModels });
    mockRemoteServerState.servers = [MOCK_SERVER];
    mockRemoteServerState.discoveredModels = {};

    render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    await act(async () => {
      await mockOnConnectServer(MOCK_SERVER);
    });

    expect(mockRsm.setActiveRemoteTextModel).toHaveBeenCalledWith('srv-1', 'llama3');
    expect(mockShowAlert).toHaveBeenCalledWith('Connected!', expect.stringContaining('My Server'), expect.any(Array));
  });

  it('handleConnectServer — success with no models shows "No Models Found" alert', async () => {
    const { remoteServerManager: mockRsm } = jest.requireMock('../../../src/services');
    mockRsm.testConnection.mockResolvedValueOnce({ success: true, models: [] });
    mockRemoteServerState.servers = [MOCK_SERVER];
    mockRemoteServerState.discoveredModels = {};

    render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    await act(async () => {
      await mockOnConnectServer(MOCK_SERVER);
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Connected — No Models Found', expect.stringContaining('My Server'));
    expect(mockRsm.setActiveRemoteTextModel).not.toHaveBeenCalled();
  });

  it('handleConnectServer — connection failure shows Connection Failed alert', async () => {
    const { remoteServerManager: mockRsm } = jest.requireMock('../../../src/services');
    mockRsm.testConnection.mockResolvedValueOnce({ success: false, error: 'Timeout' });

    render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    await act(async () => {
      await mockOnConnectServer(MOCK_SERVER);
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Connection Failed', 'Timeout');
  });

  // ===========================================================================
  // handleScanNetwork
  // ===========================================================================

  it('handleScanNetwork — scan error shows Scan Failed alert', async () => {
    const { discoverLANServers } = jest.requireMock('../../../src/services/networkDiscovery');
    discoverLANServers.mockRejectedValueOnce(new Error('wifi off'));

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const scanBtn = result.getByTestId('scan-network-btn');
    await act(async () => {
      fireEvent.press(scanBtn);
      await flushPromises();
    });

    expect(mockShowAlert).toHaveBeenCalledWith('Scan Failed', expect.stringContaining('Could not scan'));
  });

  it('handleScanNetwork — no reachable servers shows No Servers Found alert', async () => {
    const { discoverLANServers } = jest.requireMock('../../../src/services/networkDiscovery');
    discoverLANServers.mockResolvedValueOnce([]);
    // testConnection returns failure so reachable set is empty
    mockRemoteServerState.testConnection.mockResolvedValue({ success: false });
    mockRemoteServerState.servers = [];

    const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
    await flushPromises();

    const scanBtn = result.getByTestId('scan-network-btn');
    await act(async () => {
      fireEvent.press(scanBtn);
      await flushPromises();
    });

    expect(mockShowAlert).toHaveBeenCalledWith(
      'No Servers Found',
      expect.stringContaining('WiFi'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Get Off Grid AI Desktop' }),
      ]),
    );
  });

  // ===========================================================================
  // Curated LiteRT models (Android-only)
  // ===========================================================================
  describe('LiteRT models', () => {
    const originalOS = Platform.OS;

    afterEach(() => { Platform.OS = originalOS; });

    it('renders curated LiteRT cards on Android', async () => {
      Platform.OS = 'android';
      const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
      await flushPromises();

      expect(result.getByTestId('litert-model-0')).toBeTruthy();
      expect(result.getByTestId('litert-model-1')).toBeTruthy();
    });

    it('does NOT render LiteRT cards on iOS', async () => {
      Platform.OS = 'ios';
      const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
      await flushPromises();

      expect(result.queryByTestId('litert-model-0')).toBeNull();
    });

    // DELETED (mockist, #510): 'filters out LiteRT models that exceed RAM headroom' jest.mocked our own
    // stores/services/hardware and asserted the PRE-FIX BUGGY behavior — that an over-budget curated
    // LiteRT card is hidden at 4GB. That is exactly the defect: an over-budget-but-WARNABLE model (Gemma
    // 4 E4B) must be OFFERED behind the "Download anyway" sheet, not silently hidden. Per doctrine, a
    // test that mocks our own code proves nothing and here it encoded the bug, so it is deleted rather
    // than repaired. The correct behavior is asserted at the RENDERED layer (over a real device-boundary
    // fake, no mocks of our code) in __tests__/integration/memory/curatedLiteRTOverBudgetWarning.rendered.redflow.test.tsx.

    it('downloading a LiteRT model uses the curated parent id', async () => {
      Platform.OS = 'android';
      mockDownloadModelBackground.mockResolvedValue({ downloadId: 7 });
      const result = render(<ModelDownloadScreen navigation={mockNavigation} />);
      await flushPromises();

      await act(async () => { fireEvent.press(result.getByTestId('litert-model-0-download')); });

      expect(mockDownloadModelBackground).toHaveBeenCalledWith(
        LITERT_PARENT_ID,
        expect.objectContaining({ name: expect.stringMatching(/\.litertlm$/) }),
      );
    });

  });
});
