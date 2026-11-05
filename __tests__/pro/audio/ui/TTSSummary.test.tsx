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

  it('names the voice by its label, never its engine id', () => {
    const engineId = useTTSStore.getState().settings.engineId;
    act(() => {
      useTTSStore.setState({ voices: [{ id: 'am_michael', label: 'Michael' }] as never });
    });
    set({ enabled: true, voiceByEngine: { [engineId]: 'am_michael' }, speed: 1.2 });
    const view = render(<TTSSummary />);
    expect(view.getByText('Michael · 1.2×')).toBeTruthy();
    expect(view.queryByText(/am_michael/)).toBeNull();
  });

  it('falls back to the saved id when the voice list does not hold it yet', () => {
    const engineId = useTTSStore.getState().settings.engineId;
    act(() => {
      useTTSStore.setState({ voices: [] as never });
    });
    set({ enabled: true, voiceByEngine: { [engineId]: 'af_heart' }, speed: 1.2 });
    expect(render(<TTSSummary />).getByText('af_heart · 1.2×')).toBeTruthy();
  });

  it('shows the speed alone before a voice is chosen', () => {
    set({ enabled: true, voiceByEngine: {}, speed: 1 });
    expect(render(<TTSSummary />).getByText('1×')).toBeTruthy();
  });
});
