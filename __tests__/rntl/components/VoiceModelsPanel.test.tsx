/**
 * VoiceModelsPanel tests
 *
 * The Voice picker (Models screen tab + home/chat Voice sheet). With a single
 * engine it is a VOICE picker, not an engine picker. Verifies:
 *  - the RAM privacy banner
 *  - not-downloaded → a single "Download voice" action (opt-in)
 *  - downloaded → a selectable list of voices; tapping one selects it
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
jest.mock('../../../pro/audio/ttsStore', () => ({ useTTSStore: () => mockStoreState }));

import { useFocusEffect } from '@react-navigation/native';
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
    expect(getByText(/nothing is sent anywhere/)).toBeTruthy();
  });

  it('lists voices when the model is downloaded and selects one on tap', async () => {
    const { getByTestId } = await renderPanel();
    expect(getByTestId('voice-af_heart')).toBeTruthy();
    expect(getByTestId('voice-bf_emma')).toBeTruthy();

    await act(async () => { fireEvent.press(getByTestId('voice-bf_emma')); });
    expect(actions.setVoice).toHaveBeenCalledWith('bf_emma');
  });

  it('shows an opt-in download when the model is not downloaded', async () => {
    mockDownloads = []; // service has no tts entry → not downloaded / not downloading
    mockStoreState.isReady = false;
    const { getByText } = await renderPanel();

    const cta = getByText('Download voice');
    expect(cta).toBeTruthy();
    await act(async () => { fireEvent.press(cta); });
    await waitFor(() => expect(actions.downloadModels).toHaveBeenCalled());
  });

  it('shows the model as DOWNLOADED (voices) when the service reports completed, even if the engine is not loaded — the mismatch fix', async () => {
    // Regression for the Download-Manager-vs-Voice-panel mismatch: the service is
    // the single source. When it says 'completed', the panel shows voices — never a
    // stale 0% progress bar — regardless of the engine being loaded or any store flag.
    mockDownloads = [ttsDl('completed')];
    mockStoreState.isReady = false;
    mockStoreState.settings = { modelDownloaded: {} };
    const { getByTestId, queryByText } = await renderPanel();
    expect(getByTestId('voice-af_heart')).toBeTruthy();
    expect(queryByText('Download voice')).toBeNull();
    expect(queryByText('0%')).toBeNull();
  });

  it('shows live progress while the service reports downloading', async () => {
    mockDownloads = [ttsDl('downloading', 0.4)];
    mockStoreState.isReady = false;
    const { getByText } = await renderPanel();
    expect(getByText('40%')).toBeTruthy();
  });

  it('shows progress (not the idle CTA) for queued and paused too — the shared in-progress predicate', async () => {
    // Regression: the panel used a bare `=== 'downloading'`, so a queued or a
    // kill-interrupted (paused) TTS download flashed the "Download voice" CTA.
    for (const status of ['queued', 'paused'] as const) {
      mockDownloads = [ttsDl(status, 0.4)];
      mockStoreState.isReady = false;
      const { getByText, queryByText } = await renderPanel();
      expect(getByText('40%')).toBeTruthy();
      expect(queryByText('Download voice')).toBeNull();
    }
  });

  it('backfills the persisted-downloaded flag from disk on focus', async () => {
    let focusCb: (() => void) | undefined;
    (useFocusEffect as jest.Mock).mockImplementation((cb: () => void) => { focusCb = cb; });
    await renderPanel();
    actions.checkDownloadStatus.mockClear(); // drop the mount-effect call
    await act(async () => { focusCb?.(); await Promise.resolve(); });
    expect(actions.checkDownloadStatus).toHaveBeenCalled();
  });
});
