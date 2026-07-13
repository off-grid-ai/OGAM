/**
 * RemoteServerModal Component Tests
 *
 * Tests for the remote server configuration modal including:
 * - Rendering for add vs. edit mode
 * - Form validation
 * - Form population when editing
 * - Test connection flow (success, failure, exception)
 * - Discovered models display
 * - Save operations (add new, update existing)
 * - Public network warning
 * - Error handling
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Mock AppSheet
jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, title }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text>{title}</Text>
        {children}
      </View>
    );
  },
}));

jest.mock('../../../src/services/remoteServerManager', () => ({
  remoteServerManager: {
    testConnectionByEndpoint: jest.fn(),
    testConnection: jest.fn().mockResolvedValue({ success: true, latency: 10 }),
    addServer: jest.fn(),
    updateServer: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../../src/stores', () => ({
  useRemoteServerStore: {
    getState: jest.fn(),
  },
}));

jest.mock('../../../src/services/httpClient', () => ({
  isPrivateNetworkEndpoint: jest.fn(() => true),
}));

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({
    colors: {
      textMuted: '#666',
      background: '#000',
      surface: '#222',
      surfaceLight: '#333',
      border: '#444',
      textSecondary: '#aaa',
      text: '#fff',
      error: '#f00',
      errorBackground: '#fee',
      primary: '#4a90d9',
      success: '#4caf50',
    },
    elevation: {
      level0: { backgroundColor: '#000', borderWidth: 0, borderColor: 'transparent' },
      level1: { backgroundColor: '#222', borderWidth: 1, borderColor: '#444' },
      level2: { backgroundColor: '#333', borderWidth: 1, borderColor: '#444' },
      level3: { backgroundColor: '#333F2', borderTopWidth: 1, borderColor: '#444', borderRadius: 16 },
      level4: { backgroundColor: '#333FA', borderTopWidth: 1, borderColor: '#4a90d9', borderRadius: 16 },
      handle: { width: 36, height: 5, backgroundColor: '#444', borderRadius: 2.5 },
    },
  }),
  useThemedStyles: (fn: any) =>
    fn(
      {
        textSecondary: '#aaa', surfaceLight: '#222', text: '#fff',
        error: '#f00', errorBackground: '#fee', primary: '#4a90d9',
        textMuted: '#666', background: '#000', success: '#4caf50',
      },
      {},
    ),
}));

import { RemoteServerModal } from '../../../src/components/RemoteServerModal';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { isPrivateNetworkEndpoint } from '../../../src/services/httpClient';

const mockTestConnection = remoteServerManager.testConnectionByEndpoint as jest.Mock;
const mockAddServer = remoteServerManager.addServer as jest.Mock;
const mockUpdateServer = remoteServerManager.updateServer as jest.Mock;
const mockIsPrivate = isPrivateNetworkEndpoint as jest.Mock;
const mockSetDiscoveredModels = jest.fn();

jest.mock('../../../src/components/CustomAlert', () =>
  require('../../helpers/mockCustomAlert').customAlertMock,
);
const { mockShowAlert } = require('../../helpers/mockCustomAlert');

function createMockServer(overrides: Partial<any> = {}) {
  return {
    id: 'server-1',
    name: 'My Server',
    endpoint: 'http://192.168.1.50:11434', // NOSONAR
    providerType: 'openai-compatible' as const,
    createdAt: new Date().toISOString(),
    notes: 'Some notes',
    ...overrides,
  };
}

const VALID_ENDPOINT = 'http://192.168.1.50:7878'; // NOSONAR — matches the endpoint field placeholder

describe('RemoteServerModal', () => {
  const onClose = jest.fn();
  const onSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPrivate.mockReturnValue(true);
    const { useRemoteServerStore } = require('../../../src/stores');
    (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
      setDiscoveredModels: mockSetDiscoveredModels,
    });
  });

  // ==========================================================================
  // Rendering
  // ==========================================================================
  describe('rendering', () => {
    it('renders nothing when not visible', () => {
      const { queryByTestId } = render(<RemoteServerModal visible={false} onClose={onClose} />);
      expect(queryByTestId('app-sheet')).toBeNull();
    });

    it('shows "Add Remote Server" title for new server', () => {
      const { getByText } = render(<RemoteServerModal visible onClose={onClose} />);
      expect(getByText('Add Remote Server')).toBeTruthy();
    });

    it('shows "Edit Server" title when editing', () => {
      const { getByText } = render(
        <RemoteServerModal visible onClose={onClose} server={createMockServer()} />,
      );
      expect(getByText('Edit Server')).toBeTruthy();
    });

    it('shows "Add Server" save button for new server', () => {
      const { getByText } = render(<RemoteServerModal visible onClose={onClose} />);
      expect(getByText('Add Server')).toBeTruthy();
    });

    it('shows "Update Server" save button when editing', () => {
      const { getByText } = render(
        <RemoteServerModal visible onClose={onClose} server={createMockServer()} />,
      );
      expect(getByText('Update Server')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Form population (edit mode)
  // ==========================================================================
  describe('form population', () => {
    it('populates name and endpoint when editing server', () => {
      const server = createMockServer({ name: 'Test Ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR
      const { getByDisplayValue } = render(
        <RemoteServerModal visible onClose={onClose} server={server} />,
      );
      expect(getByDisplayValue('Test Ollama')).toBeTruthy();
      expect(getByDisplayValue('http://192.168.1.10:11434')).toBeTruthy(); // NOSONAR
    });

    it('populates notes when editing server', () => {
      const server = createMockServer({ notes: 'Local dev server' });
      const { getByDisplayValue } = render(
        <RemoteServerModal visible onClose={onClose} server={server} />,
      );
      expect(getByDisplayValue('Local dev server')).toBeTruthy();
    });

    it('resets form fields when switching from edit to new mode', () => {
      const server = createMockServer({ name: 'Existing Server' });
      const { rerender, queryByDisplayValue } = render(
        <RemoteServerModal visible onClose={onClose} server={server} />,
      );
      rerender(<RemoteServerModal visible onClose={onClose} />);
      expect(queryByDisplayValue('Existing Server')).toBeNull();
    });
  });

  // ==========================================================================
  // Form validation
  // ==========================================================================
  describe('form validation', () => {
    it('shows error when name is empty on Test Connection', async () => {
      const { getByText } = render(<RemoteServerModal visible onClose={onClose} />);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText('Server name is required')).toBeTruthy());
    });

    it('shows error when endpoint is empty on Test Connection', async () => {
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fireEvent.changeText(getByPlaceholderText('e.g., Off Grid AI Desktop'), 'My Server');
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText('Endpoint URL is required')).toBeTruthy());
    });

    it('shows invalid URL error for malformed endpoint', async () => {
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fireEvent.changeText(getByPlaceholderText('e.g., Off Grid AI Desktop'), 'My Server');
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), 'not-a-url');
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText('Invalid URL format')).toBeTruthy());
    });
  });

  // ==========================================================================
  // Public network warning display
  // ==========================================================================
  describe('public network warning display', () => {
    it('shows warning text for public internet endpoint', () => {
      mockIsPrivate.mockReturnValue(false);
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), 'https://api.example.com');
      expect(getByText(/This endpoint is on the public internet/)).toBeTruthy();
    });

    it('does not show warning for private network endpoint', () => {
      mockIsPrivate.mockReturnValue(true);
      const { queryByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), VALID_ENDPOINT);
      expect(queryByText(/This endpoint is on the public internet/)).toBeNull();
    });
  });

  // ==========================================================================
  // Test connection
  // ==========================================================================
  describe('test connection', () => {
    function fillValidForm(getByPlaceholderText: any) {
      fireEvent.changeText(getByPlaceholderText('e.g., Off Grid AI Desktop'), 'My Server');
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), VALID_ENDPOINT);
    }

    it('shows success status on successful connection', async () => {
      mockTestConnection.mockResolvedValueOnce({ success: true, latency: 42 });
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    });

    it('shows failure status on failed connection', async () => {
      mockTestConnection.mockResolvedValueOnce({ success: false, error: 'Connection refused' });
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connection refused/)).toBeTruthy());
    });

    it('shows fallback message when error field is absent', async () => {
      mockTestConnection.mockResolvedValueOnce({ success: false });
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connection failed/)).toBeTruthy());
    });

    it('shows error message when exception is thrown', async () => {
      mockTestConnection.mockRejectedValueOnce(new Error('Network unreachable'));
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText('Network unreachable')).toBeTruthy());
    });

    it('shows "Unknown error" for non-Error exceptions', async () => {
      mockTestConnection.mockRejectedValueOnce('oops');
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText('Unknown error')).toBeTruthy());
    });

    it('displays discovered models after successful connection', async () => {
      mockTestConnection.mockResolvedValueOnce({
        success: true,
        latency: 10,
        models: [
          { id: 'llama3', name: 'Llama 3', capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false } },
          { id: 'llava', name: 'LLaVA', capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false } },
        ],
      });
      const { getByText, getByPlaceholderText } = render(<RemoteServerModal visible onClose={onClose} />);
      fillValidForm(getByPlaceholderText);
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => {
        expect(getByText('Discovered Models')).toBeTruthy();
        expect(getByText('Llama 3')).toBeTruthy();
        expect(getByText('LLaVA')).toBeTruthy();
      });
    });
  });

  // ==========================================================================
  // Save - add new server
  // ==========================================================================
  describe('save - add new server', () => {
    async function connectAndEnableSave(getByText: any, getByPlaceholderText: any) {
      fireEvent.changeText(getByPlaceholderText('e.g., Off Grid AI Desktop'), 'New Server');
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), VALID_ENDPOINT);
      mockTestConnection.mockResolvedValueOnce({ success: true, latency: 10 });
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    }

    it('calls addServer when saving new server', async () => {
      mockAddServer.mockResolvedValueOnce(createMockServer({ id: 'new-1' }));
      const { getByText, getByPlaceholderText } = render(
        <RemoteServerModal visible onClose={onClose} onSave={onSave} />,
      );
      await connectAndEnableSave(getByText, getByPlaceholderText);
      await act(async () => { fireEvent.press(getByText('Add Server')); });
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Server', providerType: 'openai-compatible' }),
      );
    });

    it('calls onSave and onClose after successful add', async () => {
      const newServer = createMockServer({ id: 'new-1' });
      mockAddServer.mockResolvedValueOnce(newServer);
      const { getByText, getByPlaceholderText } = render(
        <RemoteServerModal visible onClose={onClose} onSave={onSave} />,
      );
      await connectAndEnableSave(getByText, getByPlaceholderText);
      await act(async () => { fireEvent.press(getByText('Add Server')); });
      expect(onSave).toHaveBeenCalledWith(newServer);
      expect(onClose).toHaveBeenCalled();
    });

    it('shows error alert when addServer throws', async () => {
      mockAddServer.mockRejectedValueOnce(new Error('Server unavailable'));
      const { getByText, getByPlaceholderText } = render(
        <RemoteServerModal visible onClose={onClose} />,
      );
      await connectAndEnableSave(getByText, getByPlaceholderText);
      await act(async () => { fireEvent.press(getByText('Add Server')); });
      expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Server unavailable');
    });

  });

  // ==========================================================================
  // Save - update existing server
  // ==========================================================================
  describe('save - update existing server', () => {
    async function connectForEdit(getByText: any) {
      mockTestConnection.mockResolvedValueOnce({ success: true, latency: 5 });
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    }

    it('calls updateServer when saving existing server', async () => {
      const server = createMockServer();
      mockUpdateServer.mockResolvedValueOnce(undefined);
      const { getByText } = render(
        <RemoteServerModal visible onClose={onClose} onSave={onSave} server={server} />,
      );
      await connectForEdit(getByText);
      await act(async () => { fireEvent.press(getByText('Update Server')); });
      expect(mockUpdateServer).toHaveBeenCalledWith(
        server.id,
        expect.objectContaining({ name: server.name }),
      );
    });

    it('calls onSave and onClose after successful update', async () => {
      const server = createMockServer();
      mockUpdateServer.mockResolvedValueOnce(undefined);
      const { getByText } = render(
        <RemoteServerModal visible onClose={onClose} onSave={onSave} server={server} />,
      );
      await connectForEdit(getByText);
      await act(async () => { fireEvent.press(getByText('Update Server')); });
      expect(onSave).toHaveBeenCalledWith(server);
      expect(onClose).toHaveBeenCalled();
    });

    it('shows error alert when updateServer throws', async () => {
      const server = createMockServer();
      mockUpdateServer.mockRejectedValueOnce(new Error('Update failed'));
      const { getByText } = render(
        <RemoteServerModal visible onClose={onClose} server={server} />,
      );
      await connectForEdit(getByText);
      await act(async () => { fireEvent.press(getByText('Update Server')); });
      expect(mockShowAlert).toHaveBeenCalledWith('Error', 'Update failed');
    });
  });

  // ==========================================================================
  // Public network alert on save
  // ==========================================================================
  describe('public network alert on save', () => {
    async function setupPublicEndpointWithTest(getByText: any, getByPlaceholderText: any) {
      mockIsPrivate.mockReturnValue(false);
      fireEvent.changeText(getByPlaceholderText('e.g., Off Grid AI Desktop'), 'Cloud Server');
      fireEvent.changeText(getByPlaceholderText(VALID_ENDPOINT), 'https://api.example.com');
      mockTestConnection.mockResolvedValueOnce({ success: true, latency: 10 });
      fireEvent.press(getByText('Test Connection'));
      await waitFor(() => expect(getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    }

    it('shows confirmation alert for public endpoint before saving', async () => {
      mockAddServer.mockResolvedValueOnce(createMockServer({ id: 'pub-1' }));
      const { getByText, getByPlaceholderText } = render(
        <RemoteServerModal visible onClose={onClose} />,
      );
      await setupPublicEndpointWithTest(getByText, getByPlaceholderText);
      await act(async () => { fireEvent.press(getByText('Add Server')); });
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Public Network Warning',
        expect.stringContaining('public internet'),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Continue' }),
        ]),
      );
    });

    it('proceeds with save when user taps Continue on public network alert', async () => {
      mockAddServer.mockResolvedValueOnce(createMockServer({ id: 'pub-1' }));
      const { getByText, getByPlaceholderText } = render(
        <RemoteServerModal visible onClose={onClose} onSave={onSave} />,
      );
      await setupPublicEndpointWithTest(getByText, getByPlaceholderText);
      await act(async () => { fireEvent.press(getByText('Add Server')); });
      const continueBtn = (mockShowAlert.mock.calls as any)[0][2].find((b: any) => b.text === 'Continue');
      await act(async () => { continueBtn.onPress(); });
      expect(mockAddServer).toHaveBeenCalled();
    });
  });
});
