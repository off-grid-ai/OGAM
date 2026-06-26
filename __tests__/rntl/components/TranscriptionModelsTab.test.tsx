/**
 * TranscriptionModelsTab tests
 *
 * The Models > Transcription Models tab (speech-to-text / Whisper). Now supports
 * MULTIPLE downloaded models (presentModelIds) with one active (downloadedModelId).
 * Verifies:
 *  - the built-in ggml catalogue renders as ModelCards + the privacy banner
 *  - tapping a not-present model downloads it via the whisper store
 *  - every on-disk (present) model shows as downloaded, not just the active one
 *  - tapping a present-but-inactive model SELECTS it (selectModel), no re-download
 *  - per-model delete calls deleteModelById
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../../src/services', () => ({
  WHISPER_MODELS: [
    { id: 'tiny.en', name: 'Tiny', size: 75, lang: 'en', url: 'https://x/ggml-tiny.en.bin', description: 'Fastest, English only' },
    { id: 'small', name: 'Small', size: 466, lang: 'multi', url: 'https://x/ggml-small.bin', description: 'High accuracy, 99 languages' },
  ],
}));

const mockWhisperActions = {
  downloadModel: jest.fn(async () => {}),
  downloadFromUrl: jest.fn(async () => {}),
  selectModel: jest.fn(async () => {}),
  deleteModel: jest.fn(),
  deleteModelById: jest.fn(async () => {}),
  refreshPresentModels: jest.fn(async () => {}),
  clearError: jest.fn(),
};
let mockWhisperState: any;
jest.mock('../../../src/stores', () => ({
  useWhisperStore: () => mockWhisperState,
}));

jest.mock('../../../src/components', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    ModelCard: ({ model, isDownloaded, isActive, onPress, onDownload, onDelete, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={!onPress}>
        <Text testID={`${testID}-name`}>{model.name}</Text>
        {isDownloaded && <Text testID={`${testID}-downloaded`}>downloaded</Text>}
        {isActive && <Text testID={`${testID}-active`}>active</Text>}
        {onDownload && <TouchableOpacity testID={`${testID}-download`} onPress={onDownload}><Text>Download</Text></TouchableOpacity>}
        {onDelete && <TouchableOpacity testID={`${testID}-delete`} onPress={onDelete}><Text>Delete</Text></TouchableOpacity>}
      </TouchableOpacity>
    ),
  };
});

const mockShowAlert = jest.fn((title: string, message: string, buttons: any[]) => ({
  visible: true, title, message, buttons,
}));
jest.mock('../../../src/components/CustomAlert', () => {
  const { View } = require('react-native');
  return {
    CustomAlert: () => <View testID="custom-alert" />,
    showAlert: (...a: any[]) => mockShowAlert(...(a as [string, string, any[]])),
    hideAlert: () => ({ visible: false }),
    initialAlertState: { visible: false },
  };
});

import { useFocusEffect } from '@react-navigation/native';
import { TranscriptionModelsTab } from '../../../src/screens/ModelsScreen/TranscriptionModelsTab';

describe('TranscriptionModelsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhisperState = {
      downloadedModelId: null,
      presentModelIds: [],
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

  it('downloads a not-present model when its card is tapped', () => {
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId('transcription-model-card-0'));
    expect(mockWhisperActions.downloadModel).toHaveBeenCalledWith('tiny.en');
    expect(mockWhisperActions.selectModel).not.toHaveBeenCalled();
  });

  it('marks every on-disk model as downloaded, and the active one as active', () => {
    // Both models present on disk; only `small` is the active/selected one.
    mockWhisperState.presentModelIds = ['tiny.en', 'small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId, queryByTestId } = render(<TranscriptionModelsTab />);
    // Both show as downloaded...
    expect(getByTestId('transcription-model-card-0-downloaded')).toBeTruthy();
    expect(getByTestId('transcription-model-card-1-downloaded')).toBeTruthy();
    // ...but only `small` is active.
    expect(queryByTestId('transcription-model-card-0-active')).toBeNull();
    expect(getByTestId('transcription-model-card-1-active')).toBeTruthy();
  });

  it('selects a present-but-inactive model without re-downloading', () => {
    // `tiny.en` is on disk but `small` is the active one.
    mockWhisperState.presentModelIds = ['tiny.en', 'small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId('transcription-model-card-0'));
    expect(mockWhisperActions.selectModel).toHaveBeenCalledWith('tiny.en');
    expect(mockWhisperActions.downloadModel).not.toHaveBeenCalled();
  });

  it('does nothing when the already-active model card is tapped', () => {
    mockWhisperState.presentModelIds = ['small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId('transcription-model-card-1'));
    expect(mockWhisperActions.selectModel).not.toHaveBeenCalled();
    expect(mockWhisperActions.downloadModel).not.toHaveBeenCalled();
  });

  it('deletes a specific present model via per-model delete', () => {
    mockWhisperState.presentModelIds = ['tiny.en'];
    const { getByTestId } = render(<TranscriptionModelsTab />);
    // Per-model delete is only offered for present models.
    fireEvent.press(getByTestId('transcription-model-card-0-delete'));
    // Delete is confirmed via CustomAlert; press the destructive button.
    const remove = (mockShowAlert.mock.results.at(-1)?.value.buttons ?? []).find(
      (b: any) => b.style === 'destructive',
    );
    act(() => remove.onPress());
    expect(mockWhisperActions.deleteModelById).toHaveBeenCalledWith('tiny.en');
  });

  it('re-derives present models from disk when the screen regains focus', () => {
    // Disk is the source of truth: returning from the Download Manager (where a
    // model may have been downloaded or deleted) must re-probe, not show stale state.
    let focusCb: (() => void) | undefined;
    (useFocusEffect as jest.Mock).mockImplementation((cb: () => void) => { focusCb = cb; });
    render(<TranscriptionModelsTab />);
    mockWhisperActions.refreshPresentModels.mockClear(); // drop the mount-effect call
    act(() => { focusCb?.(); });
    expect(mockWhisperActions.refreshPresentModels).toHaveBeenCalledTimes(1);
  });
});
