/**
 * VoiceModelsPanel tests
 *
 * The Voice model picker (Models screen tab + home/chat Voice sheet). Verifies:
 *  - the RAM privacy banner
 *  - not-downloaded → a single model download action (opt-in)
 *  - downloaded → the local model appears without speaker choices
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('@offgrid/core/services/hardware', () => ({
  hardwareService: { getTotalMemoryGB: jest.fn(() => 8) },
}));

jest.mock('@offgrid/core/components/CustomAlert', () => {
  const { View } = require('react-native');
  return {
    CustomAlert: () => <View testID="custom-alert" />,
    showAlert: (title: string, message: string, buttons: any[]) => ({ visible: true, title, message, buttons }),
    hideAlert: () => ({ visible: false }),
    initialAlertState: { visible: false },
  };
});

jest.mock('@offgrid/core/components/AnimatedPressable', () => {
  const { TouchableOpacity } = require('react-native');
  return {
    AnimatedPressable: ({ children, onPress, disabled, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={disabled}>{children}</TouchableOpacity>
    ),
  };
});

const mockEngine = {
  id: 'kokoro',
  displayName: 'Kokoro TTS',
  capabilities: { peakRamMB: 82 },
  getRequiredAssets: () => [{ id: 'a', sizeBytes: 82 * 1024 * 1024 }],
  getActiveVoice: () => null,
};
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: () => mockEngine },
}));

// The panel reads download state from the SAME service the Download Manager does.
let mockDownloads: any[] = [];
jest.mock('@offgrid/core/services/modelDownloadService/useModelDownloads', () => ({
  useModelDownloads: () => mockDownloads,
}));
const ttsDl = (status: string, progress = status === 'completed' ? 1 : 0) =>
  ({ id: 'tts:kokoro', modelType: 'tts', name: 'Kokoro TTS', status, progress });

const actions = {
  setVoice: jest.fn(async () => {}),
  downloadModels: jest.fn(async () => {}),
  deleteModels: jest.fn(async () => {}),
  checkDownloadStatus: jest.fn(async () => {}),
  clearError: jest.fn(),
};
let mockStoreState: any;
jest.mock('../../../pro/audio/ttsStore', () => ({
  useTTSStore: (selector?: (state: any) => unknown) =>
    selector ? selector(mockStoreState) : mockStoreState,
}));

import { VoiceModelsPanel } from '../../../pro/audio/ui/VoiceModelsPanel';

const VOICES = [
  { id: 'af_heart', label: 'Warm', metadata: { accent: 'US', gender: 'Female', persona: 'Friendly' } },
  { id: 'bf_emma', label: 'Gentle', metadata: { accent: 'British', gender: 'Female', persona: 'Soft' } },
];

const renderPanel = async () => {
  const utils = render(<VoiceModelsPanel />);
  await act(async () => { await Promise.resolve(); });
  return utils;
};

describe('VoiceModelsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloads = [ttsDl('completed')];
    mockStoreState = {
      isReady: true,
      error: null,
      voices: VOICES,
      activeVoiceId: 'af_heart',
      settings: { modelDownloaded: {} },
      ...actions,
    };
  });

  it('shows the RAM privacy banner', async () => {
    const { getByText } = await renderPanel();
    expect(getByText(/your voice never leaves it/)).toBeTruthy();
  });

  it('shows the installed model without speaker choices', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderPanel();
    expect(getByTestId('voice-model-kokoro')).toBeTruthy();
    expect(getByText('Kokoro TTS')).toBeTruthy();
    expect(queryByTestId('voice-af_heart')).toBeNull();
    expect(queryByTestId('models-tts-language')).toBeNull();
  });

  it('shows an opt-in download when the model is not downloaded', async () => {
    mockDownloads = []; // service has no tts entry → not downloaded / not downloading
    mockStoreState.isReady = false;
    const { getByTestId } = await renderPanel();

    const cta = getByTestId('voice-model-kokoro-download');
    expect(cta).toBeTruthy();
    await act(async () => { fireEvent.press(cta); });
    await waitFor(() => expect(actions.downloadModels).toHaveBeenCalled());
  });

  it('shows the model as downloaded when the service reports completed, even if the engine is not loaded', async () => {
    // Regression for the Download-Manager-vs-Voice-panel mismatch: the service is
    // the single source. When it says 'completed', the panel shows the model — never a
    // stale 0% progress bar — regardless of the engine being loaded or any store flag.
    mockDownloads = [ttsDl('completed')];
    mockStoreState.isReady = false;
    mockStoreState.settings = { modelDownloaded: {} };
    const { getByTestId, queryByText } = await renderPanel();
    expect(getByTestId('voice-model-kokoro')).toBeTruthy();
    expect(queryByText('Download voice model')).toBeNull();
    expect(queryByText('0%')).toBeNull();
  });

  it('shows live progress while the service reports downloading', async () => {
    mockDownloads = [ttsDl('downloading', 0.4)];
    mockStoreState.isReady = false;
    const { getByText, queryByText } = await renderPanel();
    expect(getByText('40%')).toBeTruthy();
    expect(getByText('Rate unavailable')).toBeTruthy();
    expect(queryByText(/NaN/)).toBeNull();
  });

  it('shows bytes and rate when the engine reports them', async () => {
    mockDownloads = [ttsDl('downloading', 0.5)];
    mockStoreState.isReady = false;
    mockStoreState.downloadCurrentBytes = 25 * 1024 * 1024;
    mockStoreState.downloadTotalBytes = 50 * 1024 * 1024;
    mockStoreState.downloadBytesPerSecond = 2 * 1024 * 1024;
    const { getByText } = await renderPanel();
    expect(getByText('50%')).toBeTruthy();
    expect(getByText('25 MB / 50 MB · 2.0 MB/s')).toBeTruthy();
  });

  it('shows progress (not the idle CTA) for queued and paused too — the shared in-progress predicate', async () => {
    // Regression: the panel used a bare `=== 'downloading'`, so a queued or a
    // kill-interrupted (paused) TTS download flashed the "Download voice" CTA.
    for (const status of ['queued', 'paused'] as const) {
      mockDownloads = [ttsDl(status, 0.4)];
      mockStoreState.isReady = false;
      const { getByText, queryByText } = await renderPanel();
      expect(getByText('40%')).toBeTruthy();
      expect(queryByText('Download voice model')).toBeNull();
    }
  });

  it('backfills the persisted-downloaded flag from disk when the panel opens', async () => {
    actions.checkDownloadStatus.mockClear();
    await renderPanel();
    expect(actions.checkDownloadStatus).toHaveBeenCalled();
  });
});
