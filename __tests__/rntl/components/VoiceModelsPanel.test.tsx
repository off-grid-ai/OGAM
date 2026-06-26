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

let mockDownloaded = true;
const mockEngine = {
  displayName: 'Kokoro TTS',
  capabilities: { peakRamMB: 82 },
  getRequiredAssets: () => [{ id: 'a', sizeBytes: 82 * 1024 * 1024 }],
  isFullyDownloaded: () => mockDownloaded,
  checkAssetStatus: jest.fn(async () => []),
  getActiveVoice: () => null,
};
jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: () => mockEngine },
}));

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
    mockDownloaded = true;
    mockStoreState = {
      isReady: true,
      isDownloading: false,
      overallDownloadProgress: 0,
      error: null,
      voices: VOICES,
      activeVoiceId: 'af_heart',
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
    mockDownloaded = false;
    mockStoreState.isReady = false;
    const { getByText } = await renderPanel();

    const cta = getByText('Download voice');
    expect(cta).toBeTruthy();
    await act(async () => { fireEvent.press(cta); });
    await waitFor(() => expect(actions.downloadModels).toHaveBeenCalled());
  });

  it('re-derives download status from disk when the screen regains focus', async () => {
    // Disk is the source of truth: returning to the panel after a download or
    // delete elsewhere must re-probe rather than show stale state.
    let focusCb: (() => void) | undefined;
    (useFocusEffect as jest.Mock).mockImplementation((cb: () => void) => { focusCb = cb; });
    await renderPanel();
    actions.checkDownloadStatus.mockClear(); // drop the mount-effect call
    mockEngine.checkAssetStatus.mockClear();
    await act(async () => { focusCb?.(); await Promise.resolve(); });
    expect(actions.checkDownloadStatus).toHaveBeenCalled();
    expect(mockEngine.checkAssetStatus).toHaveBeenCalled();
  });
});
