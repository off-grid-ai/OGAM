/**
 * TranscriptionModelsTab tests
 *
 * The Models > Transcription Models tab (speech-to-text / Whisper). Verifies:
 *  - the built-in ggml catalogue renders as ModelCards + the privacy banner
 *  - tapping a not-downloaded model downloads it via the whisper store
 *  - a HuggingFace search queries searchWhisperRepos
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../../src/services', () => ({
  WHISPER_MODELS: [
    { id: 'tiny.en', name: 'Tiny', size: 75, lang: 'en', url: 'https://x/ggml-tiny.en.bin', description: 'Fastest, English only' },
    { id: 'small', name: 'Small', size: 466, lang: 'multi', url: 'https://x/ggml-small.bin', description: 'High accuracy, 99 languages' },
  ],
}));

const mockSearchWhisperRepos = jest.fn(async () => [] as any[]);
const mockGetWhisperFiles = jest.fn(async () => [] as any[]);
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    searchWhisperRepos: (...a: any[]) => mockSearchWhisperRepos(...a),
    getWhisperFiles: (...a: any[]) => mockGetWhisperFiles(...a),
  },
}));

const mockWhisperActions = {
  downloadModel: jest.fn(async () => {}),
  downloadFromUrl: jest.fn(async () => {}),
  deleteModel: jest.fn(),
  clearError: jest.fn(),
};
let mockWhisperState: any;
jest.mock('../../../src/stores', () => ({
  useWhisperStore: () => mockWhisperState,
}));

jest.mock('../../../src/components', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    ModelCard: ({ model, isDownloaded, onPress, onDownload, onDelete, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={!onPress}>
        <Text testID={`${testID}-name`}>{model.name}</Text>
        {isDownloaded && <Text testID={`${testID}-downloaded`}>downloaded</Text>}
        {onDownload && <TouchableOpacity testID={`${testID}-download`} onPress={onDownload}><Text>Download</Text></TouchableOpacity>}
        {onDelete && <TouchableOpacity testID={`${testID}-delete`} onPress={onDelete}><Text>Delete</Text></TouchableOpacity>}
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../../src/components/CustomAlert', () => {
  const { View } = require('react-native');
  return {
    CustomAlert: () => <View testID="custom-alert" />,
    showAlert: (title: string, message: string, buttons: any[]) => ({ visible: true, title, message, buttons }),
    hideAlert: () => ({ visible: false }),
    initialAlertState: { visible: false },
  };
});

import { TranscriptionModelsTab } from '../../../src/screens/ModelsScreen/TranscriptionModelsTab';

describe('TranscriptionModelsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhisperState = {
      downloadedModelId: null,
      downloadProgress: 0,
      error: null,
      ...mockWhisperActions,
    };
  });

  it('renders the built-in whisper catalogue and privacy banner', () => {
    const { getByTestId, getByText } = render(<TranscriptionModelsTab />);
    expect(getByTestId('transcription-model-card-0-name')).toHaveTextContent('Tiny');
    expect(getByTestId('transcription-model-card-1-name')).toHaveTextContent('Small');
    expect(getByText(/audio is never sent anywhere/)).toBeTruthy();
  });

  it('downloads a model when its card is tapped', () => {
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId('transcription-model-card-0'));
    expect(mockWhisperActions.downloadModel).toHaveBeenCalledWith('tiny.en');
  });

  it('marks the active model as downloaded', () => {
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId } = render(<TranscriptionModelsTab />);
    expect(getByTestId('transcription-model-card-1-downloaded')).toBeTruthy();
  });

  it('searches HuggingFace for other-language models', async () => {
    const { getByTestId } = render(<TranscriptionModelsTab />);
    await act(async () => {
      fireEvent.changeText(getByTestId('transcription-search'), 'hindi');
    });
    await waitFor(() => {
      expect(mockSearchWhisperRepos).toHaveBeenCalledWith('hindi');
    }, { timeout: 1500 });
  });
});
