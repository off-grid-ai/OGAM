/**
 * Kokoro v1.0: once the voice is downloaded, Models -> Voice offers ready-made profiles
 * (Echo, Puck, Fable, Deep British). Previewing Deep British loads the British dictionary
 * and the deeper playback on the native engine (the device boundary).
 */
const mockNative = {
  setNeuralVoice: jest.fn(async () => 54),
  installedNeuralVoices: jest.fn(async () => [{ id: 'kokoro-v1-en', bytes: 183e6 }]),
  setRate: jest.fn(async () => true),
  speak: jest.fn(async () => true),
  speakIn: jest.fn(async () => true),
  stop: jest.fn(async () => true),
  warmUp: jest.fn(async () => true),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
require('react-native').NativeModules.AtlasTts = mockNative;

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const { VoiceProfilesCard } = require('../../../src/atlasVoice/VoiceProfilesCard');
const { refreshInstalled } = require('../../../src/atlasVoice/neural');
const { useVoiceProfiles } = require('../../../src/atlasVoice/profiles');

describe('Kokoro v1.0 ready-made voices', () => {
  beforeEach(() => useVoiceProfiles.setState({ profiles: [] }));

  it('adds Echo, Puck, Fable and Deep British, and previews the deep voice in British English', async () => {
    await act(async () => { await refreshInstalled(); });
    const screen = render(<VoiceProfilesCard />);
    fireEvent.press(screen.getByText('Add ready-made: Echo, Puck, Fable, Deep British'));
    for (const name of ['Echo', 'Puck', 'Fable', 'Deep British']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText('Kokoro v1.0 (most natural) · Lewis (deep) · 1x')).toBeTruthy();
    expect(screen.queryByTestId('voice-profile-presets')).toBeNull();

    fireEvent.press(screen.getAllByText('Preview')[3]);
    await waitFor(() => expect(mockNative.setNeuralVoice).toHaveBeenCalledWith('kokoro-v1-en', 27, { accent: 'gb', depth: 0.9 }));
    fireEvent.press(screen.getAllByText('Preview')[0]);
    await waitFor(() => expect(mockNative.setNeuralVoice).toHaveBeenCalledWith('kokoro-v1-en', 12, { accent: 'us', depth: 1 }));
  });
});
