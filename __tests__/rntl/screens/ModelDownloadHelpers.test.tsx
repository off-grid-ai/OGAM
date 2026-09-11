/**
 * ModelDownloadHelpers Tests
 *
 * Tests for helper components and functions used by the model download screen:
 * - NetworkSection component (scanning, server list, empty state, actions)
 * - ServerCard component (server info, connection state)
 * - fetchModelFiles utility (quant filtering, error handling)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../src/components', () => ({
  Card: ({ children, style, onPress, testID }: any) => {
    const { View, TouchableOpacity } = require('react-native');
    const Container = onPress ? TouchableOpacity : View;
    return <Container style={style} onPress={onPress} testID={testID}>{children}</Container>;
  },
}));

// Hugging Face is the remote boundary. ModelDownloadHelpers now reaches it through
// modelCatalogFiles, so both import paths must resolve to the same controlled adapter.
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: { getModelFiles: jest.fn() },
}));

jest.mock('../../../src/services', () =>
  jest.requireMock('../../../src/services/huggingface'),
);

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({ colors: mockColors }),
  useThemedStyles: (fn: any) => fn(mockColors, {}),
}));

jest.mock('../../../src/constants', () => ({
  TYPOGRAPHY: {
    h2: { fontSize: 20, fontWeight: '600' },
    meta: { fontSize: 12 },
    bodySmall: { fontSize: 14 },
  },
  SPACING: { sm: 4, md: 8, lg: 12, xl: 16 },
  FONTS: { mono: 'SpaceMono' },
}));

const mockColors = {
  primary: '#007AFF',
  text: '#000',
  textSecondary: '#666',
  textMuted: '#999',
  background: '#FFF',
  surface: '#F5F5F5',
  border: '#DDD',
  warning: '#FF9500',
  success: '#525252',
};

import { RemoteServer } from '../../../src/types';
import { huggingFaceService } from '../../../src/services';
import {
  NetworkSection,
  ServerCard,
  fetchModelFiles,
} from '../../../src/screens/ModelDownloadHelpers';

const mockServer: RemoteServer = {
  id: 'server-1',
  name: 'Ollama (192.168.1.10)',
  endpoint: 'http://192.168.1.10:11434',
  provider: 'openai-compatible',
  createdAt: '2024-01-01',
};

const mockLMStudioServer: RemoteServer = {
  id: 'server-2',
  name: 'LM Studio (192.168.1.20)',
  endpoint: 'http://192.168.1.20:1234',
  provider: 'openai-compatible',
  createdAt: '2024-01-01',
};

const defaultNetworkProps = {
  servers: [] as RemoteServer[],
  discoveredModels: {},
  connectingServerId: null,
  connectedServerId: null,
  isCheckingNetwork: false,
  isScanning: false,
  onConnectServer: jest.fn(),
  onScanNetwork: jest.fn(),
  onAddManually: jest.fn(),
  colors: mockColors as any,
};

// ---------------------------------------------------------------------------
// NetworkSection
// ---------------------------------------------------------------------------

describe('NetworkSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Network Models" title', () => {
    const { getByText } = render(<NetworkSection {...defaultNetworkProps} />);
    expect(getByText('Network Models')).toBeTruthy();
  });

  it('shows scanning spinner when isCheckingNetwork=true and no servers', () => {
    const { getByText } = render(
      <NetworkSection {...defaultNetworkProps} isCheckingNetwork={true} />,
    );
    expect(getByText('Scanning your network...')).toBeTruthy();
  });

  it('does NOT show scanning spinner when servers exist even if isCheckingNetwork=true', () => {
    const { queryByText } = render(
      <NetworkSection
        {...defaultNetworkProps}
        isCheckingNetwork={true}
        servers={[mockServer]}
      />,
    );
    expect(queryByText('Scanning your network...')).toBeNull();
  });

  it('shows server cards when servers provided', () => {
    const { getByTestId } = render(
      <NetworkSection
        {...defaultNetworkProps}
        servers={[mockServer, mockLMStudioServer]}
      />,
    );
    expect(getByTestId('discovered-server-server-1')).toBeTruthy();
    expect(getByTestId('discovered-server-server-2')).toBeTruthy();
  });

  it('shows empty text when no servers and not checking', () => {
    const { getByText } = render(<NetworkSection {...defaultNetworkProps} />);
    expect(
      getByText(/No Off Grid AI Desktop, Ollama, or LM Studio server found/),
    ).toBeTruthy();
  });

  it('always shows "Scan Network" and "Add Server" buttons', () => {
    const { getByText } = render(<NetworkSection {...defaultNetworkProps} />);
    expect(getByText('Scan Network')).toBeTruthy();
    expect(getByText('Add Server')).toBeTruthy();
  });

  it('"Scan Network" button is disabled when isScanning', () => {
    const onScan = jest.fn();
    const { queryByText } = render(
      <NetworkSection
        {...defaultNetworkProps}
        isScanning={true}
        onScanNetwork={onScan}
      />,
    );
    // When busy, the button shows a spinner instead of text
    expect(queryByText('Scan Network')).toBeNull();
  });

  it('"Scan Network" button is disabled when isCheckingNetwork', () => {
    const onScan = jest.fn();
    const { queryByText } = render(
      <NetworkSection
        {...defaultNetworkProps}
        isCheckingNetwork={true}
        servers={[mockServer]}
        onScanNetwork={onScan}
      />,
    );
    // When busy, the button shows a spinner instead of text
    expect(queryByText('Scan Network')).toBeNull();
  });

  it('calls onScanNetwork when "Scan Network" pressed', () => {
    const onScan = jest.fn();
    const { getByText } = render(
      <NetworkSection {...defaultNetworkProps} onScanNetwork={onScan} />,
    );
    fireEvent.press(getByText('Scan Network'));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('calls onAddManually when "Add Server" pressed', () => {
    const onAdd = jest.fn();
    const { getByText } = render(
      <NetworkSection {...defaultNetworkProps} onAddManually={onAdd} />,
    );
    fireEvent.press(getByText('Add Server'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('calls onConnectServer with correct server when server card pressed', () => {
    const onConnect = jest.fn();
    const { getByTestId } = render(
      <NetworkSection
        {...defaultNetworkProps}
        servers={[mockServer]}
        onConnectServer={onConnect}
      />,
    );
    fireEvent.press(getByTestId('discovered-server-server-1-connect'));
    expect(onConnect).toHaveBeenCalledWith(mockServer);
  });
});

// ---------------------------------------------------------------------------
// ServerCard
// ---------------------------------------------------------------------------

describe('ServerCard', () => {
  const defaultCardProps = {
    server: mockServer,
    modelCount: 3,
    isConnecting: false,
    isConnected: false,
    onConnect: jest.fn(),
    colors: mockColors as any,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders server name', () => {
    const { getByText } = render(<ServerCard {...defaultCardProps} />);
    expect(getByText('Ollama (192.168.1.10)')).toBeTruthy();
  });

  it('shows "Ollama" for port 11434 endpoints', () => {
    const { getAllByText } = render(<ServerCard {...defaultCardProps} />);
    // The server type "Ollama" appears in the meta line (e.g., "Ollama · 3 models")
    expect(getAllByText(/Ollama/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Ollama · 3 models/).length).toBe(1);
  });

  it('shows "LM Studio" for non-11434 endpoints', () => {
    const { getAllByText } = render(
      <ServerCard {...defaultCardProps} server={mockLMStudioServer} />,
    );
    expect(getAllByText(/LM Studio/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/LM Studio · 3 models/).length).toBe(1);
  });

  it('shows model count text', () => {
    const { getByText } = render(<ServerCard {...defaultCardProps} modelCount={3} />);
    expect(getByText(/3 models/)).toBeTruthy();
  });

  it('shows singular "model" for count 1', () => {
    const { getByText } = render(<ServerCard {...defaultCardProps} modelCount={1} />);
    expect(getByText(/1 model(?!s)/)).toBeTruthy();
  });

  it('shows "Tap to connect" when modelCount is 0', () => {
    const { getByText } = render(<ServerCard {...defaultCardProps} modelCount={0} />);
    expect(getByText(/Tap to connect/)).toBeTruthy();
  });

  it('shows spinner when isConnecting', () => {
    const { queryByText } = render(
      <ServerCard {...defaultCardProps} isConnecting={true} />,
    );
    // Connect button text should not be present when spinner is shown
    expect(queryByText('Connect')).toBeNull();
  });

  it('shows Connect button when not connecting', () => {
    const { getByText } = render(<ServerCard {...defaultCardProps} />);
    expect(getByText('Connect')).toBeTruthy();
  });

  it('calls onConnect when pressed', () => {
    const onConnect = jest.fn();
    const { getByText } = render(
      <ServerCard {...defaultCardProps} onConnect={onConnect} />,
    );
    fireEvent.press(getByText('Connect'));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('shows "Connected" badge when isConnected', () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <ServerCard {...defaultCardProps} isConnected={true} />,
    );
    expect(getByTestId('discovered-server-server-1-connected')).toBeTruthy();
    expect(getByText('Connected')).toBeTruthy();
    expect(queryByTestId('discovered-server-server-1-connect')).toBeNull();
  });

  it('shows Connect button when not connected', () => {
    const { getByTestId, queryByTestId } = render(
      <ServerCard {...defaultCardProps} isConnected={false} />,
    );
    expect(getByTestId('discovered-server-server-1-connect')).toBeTruthy();
    expect(queryByTestId('discovered-server-server-1-connected')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchModelFiles
// ---------------------------------------------------------------------------

describe('fetchModelFiles', () => {
  const mockGetModelFiles = huggingFaceService.getModelFiles as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the Q4_K_M file when available', async () => {
    const q4kmFile = {
      name: 'model-Q4_K_M.gguf',
      size: 4000000000,
      quantization: 'Q4_K_M',
      downloadUrl: 'https://example.com/model-Q4_K_M.gguf',
    };
    const otherFile = {
      name: 'model-Q8_0.gguf',
      size: 8000000000,
      quantization: 'Q8_0',
      downloadUrl: 'https://example.com/model-Q8_0.gguf',
    };
    mockGetModelFiles.mockResolvedValueOnce([otherFile, q4kmFile]);

    const result = await fetchModelFiles([{ id: 'test/model' }], huggingFaceService);
    expect(result['test/model']).toEqual([q4kmFile]);
  });

  it('picks Q4_K_M even when listed after other variants', async () => {
    const q4ksFile = { name: 'model-Q4_K_S.gguf', size: 3800000000, quantization: 'Q4_K_S', downloadUrl: 'https://example.com/q4ks' };
    const q4kmFile = { name: 'model-Q4_K_M.gguf', size: 4200000000, quantization: 'Q4_K_M', downloadUrl: 'https://example.com/q4km' };
    const q8File = { name: 'model-Q8_0.gguf', size: 8000000000, quantization: 'Q8_0', downloadUrl: 'https://example.com/q8' };
    mockGetModelFiles.mockResolvedValueOnce([q4ksFile, q4kmFile, q8File]);

    const result = await fetchModelFiles([{ id: 'test/model' }], huggingFaceService);
    expect(result['test/model']).toEqual([q4kmFile]);
  });

  it('does not treat Q4_K_S or Q4_0 as Q4_K_M — model excluded', async () => {
    const files = [
      { name: 'model-Q4_K_S.gguf', size: 3800000000, quantization: 'Q4_K_S', downloadUrl: 'https://example.com/q4ks' },
      { name: 'model-Q4_0.gguf', size: 3500000000, quantization: 'Q4_0', downloadUrl: 'https://example.com/q40' },
      { name: 'model-Q8_0.gguf', size: 8000000000, quantization: 'Q8_0', downloadUrl: 'https://example.com/q8' },
    ];
    mockGetModelFiles.mockResolvedValueOnce(files);

    const result = await fetchModelFiles([{ id: 'test/model' }], huggingFaceService);
    // No Q4_K_M → model excluded from results
    expect(result['test/model']).toBeUndefined();
  });

  it('excludes model from results when no Q4_K_M present', async () => {
    const files = [
      { name: 'model-Q8_0.gguf', size: 8e9, quantization: 'Q8_0', downloadUrl: 'https://example.com/1' },
      { name: 'model-Q5_1.gguf', size: 5e9, quantization: 'Q5_1', downloadUrl: 'https://example.com/2' },
      { name: 'model-Q6_K.gguf', size: 6e9, quantization: 'Q6_K', downloadUrl: 'https://example.com/3' },
    ];
    mockGetModelFiles.mockResolvedValueOnce(files);

    const result = await fetchModelFiles([{ id: 'test/model' }], huggingFaceService);
    expect(result['test/model']).toBeUndefined();
  });

  it('handles fetch errors gracefully', async () => {
    mockGetModelFiles.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchModelFiles([{ id: 'test/model' }], huggingFaceService);
    expect(result['test/model']).toBeUndefined();
  });
});
