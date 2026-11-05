import React from 'react';
import { act, render } from '@testing-library/react-native';
import { useTTSStore } from '../../../../pro/audio/ttsStore';
import { TTSSummary } from '../../../../pro/audio/ui/TTSSummary';

const set = (patch: Record<string, unknown>) =>
  act(() => {
    useTTSStore.getState().updateSettings(patch as never);
  });

describe('TTSSummary: what the closed Text to speech row says', () => {
  it('says Off when speech is turned off, whatever voice is saved', () => {
    const engineId = useTTSStore.getState().settings.engineId;
    set({ enabled: false, voiceByEngine: { [engineId]: 'af_heart' }, speed: 1.2 });
    expect(render(<TTSSummary />).getByText('Off')).toBeTruthy();
  });

  it('names the voice and speed when on', () => {
    const engineId = useTTSStore.getState().settings.engineId;
    set({ enabled: true, voiceByEngine: { [engineId]: 'af_heart' }, speed: 1.2 });
    expect(render(<TTSSummary />).getByText('af_heart · 1.2×')).toBeTruthy();
  });

  it('shows the speed alone before a voice is chosen', () => {
    set({ enabled: true, voiceByEngine: {}, speed: 1 });
    expect(render(<TTSSummary />).getByText('1×')).toBeTruthy();
  });
});
