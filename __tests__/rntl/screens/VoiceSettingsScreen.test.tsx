/**
 * VoiceSettingsScreen Tests
 *
 * Tests for the voice settings screen including:
 * - Title display
 * - Privacy note text
 * - English and Multilingual model sections
 * - Back button navigation
 * - Active model state (name, badge, remove button)
 * - Download progress display
 * - Model download trigger
 * - Remove model confirmation alert
 * - Error display and clear
 * - Search bar
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
  Button: ({ title, onPress, disabled, style }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} style={style}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

const mockShowAlert = jest.fn((title: string, message: string, buttons?: any[]) => ({
  visible: true,
  title,
  message,
  buttons: buttons || [],
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message, buttons, _onClose }: any) => {
    if (!visible) return null;
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        <Text testID="alert-message">{message}</Text>
        {buttons && buttons.map((btn: any, i: number) => (
          <TouchableOpacity key={i} testID={`alert-btn-${i}`} onPress={btn.onPress}>
            <Text>{btn.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

jest.mock('../../../src/components/Button', () => ({
  Button: ({ title, onPress, disabled, style }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} style={style}>
        <Text>{title}</Text>
      </TouchableOpacity>
    );
  },
}));

const mockDownloadModel = jest.fn();
const mockDownloadFromUrl = jest.fn();
const mockDeleteModel = jest.fn();
const mockClearError = jest.fn();

let mockWhisperStoreValues: any = {
  downloadedModelId: null,
  isDownloading: false,
  downloadProgress: 0,
  downloadModel: mockDownloadModel,
  downloadFromUrl: mockDownloadFromUrl,
  deleteModel: mockDeleteModel,
  error: null,
  clearError: mockClearError,
};

jest.mock('../../../src/stores', () => ({
  useWhisperStore: jest.fn(() => mockWhisperStoreValues),
}));

jest.mock('../../../src/services', () => ({
  WHISPER_MODELS: [
    { id: 'tiny.en', name: 'Tiny', size: 75, lang: 'en', description: 'Fastest, English only' },
    { id: 'base.en', name: 'Base', size: 142, lang: 'en', description: 'Better accuracy, English only' },
    { id: 'small.en', name: 'Small', size: 466, lang: 'en', description: 'High accuracy, English only' },
    { id: 'medium.en', name: 'Medium', size: 1500, lang: 'en', description: 'Near human-level, English only' },
    { id: 'tiny', name: 'Tiny', size: 75, lang: 'multi', description: 'Fastest, 99 languages' },
    { id: 'base', name: 'Base', size: 142, lang: 'multi', description: 'Better accuracy, 99 languages' },
    { id: 'small', name: 'Small', size: 466, lang: 'multi', description: 'High accuracy, 99 languages' },
    { id: 'medium', name: 'Medium', size: 1500, lang: 'multi', description: 'Near human-level, 99 languages' },
  ],
}));

jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    searchWhisperRepos: jest.fn().mockResolvedValue([]),
    getWhisperFiles: jest.fn().mockResolvedValue([]),
  },
}));

import { VoiceSettingsScreen } from '../../../src/screens/VoiceSettingsScreen';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: {} }),
  };
});

describe('VoiceSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhisperStoreValues = {
      downloadedModelId: null,
      isDownloading: false,
      downloadProgress: 0,
      downloadModel: mockDownloadModel,
      downloadFromUrl: mockDownloadFromUrl,
      deleteModel: mockDeleteModel,
      error: null,
      clearError: mockClearError,
    };
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders "Voice Transcription" title', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Voice Transcription')).toBeTruthy();
    });

    it('shows privacy note about on-device transcription', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(
        getByText(/All transcription runs on-device/),
      ).toBeTruthy();
    });

    it('shows search bar', () => {
      const { getByPlaceholderText } = render(<VoiceSettingsScreen />);
      expect(getByPlaceholderText('Search models or HuggingFace...')).toBeTruthy();
    });

    it('back button calls goBack', () => {
      const { UNSAFE_getAllByType } = render(<VoiceSettingsScreen />);
      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // The first TouchableOpacity is the back button
      fireEvent.press(touchables[0]);
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // No Model Downloaded - Download Options
  // ============================================================================
  describe('download options (no model)', () => {
    it('shows English model section', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('ENGLISH ONLY')).toBeTruthy();
    });

    it('shows Multilingual model section', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText(/MULTILINGUAL/)).toBeTruthy();
    });

    it('shows model names in English section', () => {
      const { getAllByText } = render(<VoiceSettingsScreen />);
      // "Tiny" appears in both English and Multilingual sections
      expect(getAllByText('Tiny').length).toBeGreaterThanOrEqual(1);
    });

    it('shows model size for options', () => {
      const { getAllByText } = render(<VoiceSettingsScreen />);
      // Sizes appear in both English and Multilingual sections
      expect(getAllByText('75 MB').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('142 MB').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('466 MB').length).toBeGreaterThanOrEqual(1);
    });

    it('shows model description for options', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Fastest, English only')).toBeTruthy();
      expect(getByText('Better accuracy, English only')).toBeTruthy();
    });

    it('calls downloadModel when a model option is pressed', () => {
      const { getByTestId } = render(<VoiceSettingsScreen />);
      fireEvent.press(getByTestId('model-download-base.en'));
      expect(mockDownloadModel).toHaveBeenCalledWith('base.en');
    });

    it('calls downloadModel with correct id for tiny model', () => {
      const { getByTestId } = render(<VoiceSettingsScreen />);
      fireEvent.press(getByTestId('model-download-tiny.en'));
      expect(mockDownloadModel).toHaveBeenCalledWith('tiny.en');
    });
  });

  // ============================================================================
  // Downloaded Model State
  // ============================================================================
  describe('downloaded model state', () => {
    beforeEach(() => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        downloadedModelId: 'base.en',
      };
    });

    it('shows active model section label', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('ACTIVE MODEL')).toBeTruthy();
    });

    it('shows downloaded model name with language', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText(/Base — English/)).toBeTruthy();
    });

    it('shows "Active" status badge', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Active')).toBeTruthy();
    });

    it('shows "Remove" button', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Remove')).toBeTruthy();
    });

    it('shows model id as fallback when model not found in WHISPER_MODELS', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        downloadedModelId: 'unknown-model',
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('unknown-model')).toBeTruthy();
    });

    it('pressing Remove shows confirmation alert', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      fireEvent.press(getByText('Remove'));
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Remove Voice Model',
        'This will disable voice input until you download a model again.',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
          expect.objectContaining({ text: 'Remove', style: 'destructive' }),
        ]),
      );
    });
  });

  // ============================================================================
  // Download Progress State
  // ============================================================================
  describe('download progress', () => {
    beforeEach(() => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        isDownloading: true,
        downloadProgress: 0.45,
      };
    });

    it('shows downloading state with percentage', () => {
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Downloading... 45%')).toBeTruthy();
    });

    it('shows 0% at start of download', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        isDownloading: true,
        downloadProgress: 0,
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Downloading... 0%')).toBeTruthy();
    });

    it('shows 100% near end of download', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        isDownloading: true,
        downloadProgress: 1,
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Downloading... 100%')).toBeTruthy();
    });

    it('rounds progress percentage', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        isDownloading: true,
        downloadProgress: 0.678,
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Downloading... 68%')).toBeTruthy();
    });
  });

  // ============================================================================
  // Error State
  // ============================================================================
  describe('error state', () => {
    it('shows error message with tap to dismiss when whisperError is set', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        error: 'Download failed: network error',
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      expect(getByText('Download failed: network error (tap to dismiss)')).toBeTruthy();
    });

    it('calls clearError when error is tapped', () => {
      mockWhisperStoreValues = {
        ...mockWhisperStoreValues,
        error: 'Download failed',
      };
      const { getByText } = render(<VoiceSettingsScreen />);
      fireEvent.press(getByText('Download failed (tap to dismiss)'));
      expect(mockClearError).toHaveBeenCalled();
    });

    it('does not show error when error is null', () => {
      const { queryByText } = render(<VoiceSettingsScreen />);
      expect(queryByText('Download failed')).toBeNull();
    });
  });
});
