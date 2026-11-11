/**
 * Models -> Voice -> Import voice file: the user picks a sherpa-onnx voice they downloaded,
 * it appears in the voice list under a readable name and is used straight away. A voice with
 * many speakers gets a speaker stepper. The file picker and native engine are the device boundary.
 */
const installed: { id: string; bytes: number }[] = [];
const mockNative = {
  importNeuralVoice: jest.fn(async (_uri: string, name: string) => {
    const id = name.replace(/\.tar\.bz2$/, '');
    installed.push({ id, bytes: 77e6 });
    return id;
  }),
  installedNeuralVoices: jest.fn(async () => installed),
  setNeuralVoice: jest.fn(async (id: string) => (id.includes('vctk') ? 109 : 1)),
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
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { pick } from '@react-native-documents/picker';

const { AtlasVoicePanel } = require('../../../src/atlasVoice/VoicePanel');

const pickFile = (name: string) => (pick as jest.Mock).mockResolvedValueOnce([{ uri: `content://downloads/${name}`, name }]);

describe('Import voice file', () => {
  it('adds a downloaded Piper voice under a readable name and uses it', async () => {
    const screen = render(<AtlasVoicePanel />);
    pickFile('vits-piper-en_GB-northern_english_male-medium.tar.bz2');
    fireEvent.press(screen.getByText('Import voice file'));
    expect(await screen.findByText('Northern English Male (Piper, en GB)')).toBeTruthy();
    expect(mockNative.importNeuralVoice).toHaveBeenCalledWith('content://downloads/vits-piper-en_GB-northern_english_male-medium.tar.bz2', 'vits-piper-en_GB-northern_english_male-medium.tar.bz2');
    await waitFor(() => expect(mockNative.setNeuralVoice).toHaveBeenLastCalledWith('vits-piper-en_GB-northern_english_male-medium', 0, { accent: '', depth: 1 }));
    expect(screen.queryByTestId('imported-speaker-stepper')).toBeNull();
  });

  it('lets the user step through the speakers of a multi-speaker voice', async () => {
    const screen = render(<AtlasVoicePanel />);
    pickFile('vits-piper-en_GB-vctk-medium.tar.bz2');
    fireEvent.press(screen.getByText('Import voice file'));
    expect(await screen.findByText('Speaker 1 of 109')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next speaker'));
    expect(await screen.findByText('Speaker 2 of 109')).toBeTruthy();
    expect(mockNative.setNeuralVoice).toHaveBeenLastCalledWith('vits-piper-en_GB-vctk-medium', 1, { accent: '', depth: 1 });
  });

  it('explains why a file is not a voice Atlas can play', async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert');
    mockNative.importNeuralVoice.mockRejectedValueOnce(new Error('This Piper voice has not been converted for sherpa-onnx.'));
    const screen = render(<AtlasVoicePanel />);
    pickFile('en_GB-alan-medium.zip');
    fireEvent.press(screen.getByText('Import voice file'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not import this voice', 'This Piper voice has not been converted for sherpa-onnx.'));
  });
});
