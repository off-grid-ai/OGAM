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
    ModelCard: ({ model, isDownloaded, isActive, isDownloading, isQueued, downloadBytes, onPress, onDownload, onDelete, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={!onPress}>
        <Text testID={`${testID}-name`}>{model.name}</Text>
        {isDownloaded && <Text testID={`${testID}-downloaded`}>downloaded</Text>}
        {isActive && <Text testID={`${testID}-active`}>active</Text>}
        {isDownloading && <Text testID={`${testID}-downloading`}>downloading</Text>}
        {isQueued && <Text testID={`${testID}-queued`}>queued</Text>}
        {downloadBytes && <Text testID={`${testID}-bytes`}>{`${downloadBytes.downloaded}/${downloadBytes.total}`}</Text>}
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
// Real download store (NOT mocked) — the tab derives in-flight STT state from it.
import { useDownloadStore } from '../../../src/stores/downloadStore';

const seedSttDownload = (modelId: string, status: string, progress = 0) => {
  useDownloadStore.setState({
    downloads: {
      [modelId]: {
        modelKey: modelId, downloadId: `dl-${modelId}`, modelId: `whisper-${modelId}`,
        fileName: `ggml-${modelId}.bin`, quantization: '', modelType: 'stt',
        status, bytesDownloaded: 0, totalBytes: 100, combinedTotalBytes: 100,
        progress, createdAt: 0,
      } as any,
    },
  });
};

describe('TranscriptionModelsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadStore.setState({ downloads: {} });
    mockWhisperState = {
      downloadedModelId: null,
      presentModelIds: [],
      downloadProgressById: {},
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

  it('shows a model as downloadable (not stuck downloading) when its STT download FAILED in the download store', () => {
    // The bug: the Download Manager marked the STT download failed, but this tab kept
    // showing progress. Deriving from the canonical store, a failed entry is not active.
    seedSttDownload('tiny.en', 'failed', 0.4);
    const { getByTestId } = render(<TranscriptionModelsTab />);
    // Not stuck "downloading" → the download affordance is offered again.
    fireEvent.press(getByTestId('transcription-model-card-0-download'));
    expect(mockWhisperActions.downloadModel).toHaveBeenCalledWith('tiny.en');
  });

  it('treats an active STT download-store entry as downloading (no re-download affordance)', () => {
    seedSttDownload('tiny.en', 'running', 0.6);
    const { queryByTestId } = render(<TranscriptionModelsTab />);
    // Downloading → no download button and the card is not tappable to re-download.
    expect(queryByTestId('transcription-model-card-0-download')).toBeNull();
  });

  it('shows a QUEUED (pending) STT download as Queued, not as a 0% download', () => {
    // The bug: a pending STT entry rendered "0%" instead of "Queued".
    seedSttDownload('tiny.en', 'pending', 0);
    const { getByTestId, queryByTestId } = render(<TranscriptionModelsTab />);
    expect(getByTestId('transcription-model-card-0-queued')).toBeTruthy();
    expect(queryByTestId('transcription-model-card-0-downloading')).toBeNull();
    // Bytes are still surfaced ("0 B / size") so it matches the Text/Image cards.
    expect(getByTestId('transcription-model-card-0-bytes')).toHaveTextContent(/^0\/\d+$/);
  });

  // NOTE: the whisper-store FALLBACK cases moved to a real rendered test
  // (__tests__/integration/models/whisperPickerCanonicalDownloadProgress.rendered.test.tsx). They
  // used to seed the MOCKED store (mockWhisperState.downloadProgressById) and assert, but the
  // derivation now lives in the useSttDownloadState owner which reads the REAL stores — a mock of
  // our own store proves nothing there, so they're deleted rather than repaired (test doctrine).

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
