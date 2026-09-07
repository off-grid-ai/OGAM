/**
 * Replay renders the play control + transcript for a conversation with kept audio, and says so when a
 * record has no audio refs. The native player + clip prep are mocked (device-verified separately).
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ goBack: jest.fn() }), useRoute: () => ({ params: { sessionId: 's1' } }) };
});
jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb',
    surface: '#111', border: '#333', primary: '#34D399'
  };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} }) };
});
jest.mock('../../../src/hooks/useAudioClipPlayer', () => ({
  useAudioClipPlayer: () => ({ ready: true, playing: false, error: null, toggle: jest.fn() })
}));
jest.mock('../../../src/services/ambient/replayClipFactory', () => ({
  ensureReplayDir: jest.fn(async () => {}),
  prepareReplayClipForSource: jest.fn(async () => '/clip.wav')
}));

jest.mock('../../../src/stores/ambientTimelineStore', () => {
  let sessions: any[] = [];
  const hook = (sel: any) => sel({ sessions });
  hook.__set = (next: any[]) => { sessions = next; };
  return { useAmbientTimelineStore: hook };
});

import { AmbientReplayScreen } from '../../../src/screens/AmbientReplayScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';
const store = useAmbientTimelineStore as any;

const withAudio = {
  id: 's1', startMs: 1_005_000, endMs: 1_012_000, speechMs: 7000,
  summary: { title: 'Standup', headline: 'x', decisions: [], actionItems: [], people: [] },
  summaryStatus: 'ok', flaggedSegmentIds: ['a'],
  segments: [{ id: 'a', startMs: 1_005_000, endMs: 1_006_000, transcript: 'Ship Friday.' }],
  recordingPath: '/rec.wav', captureStartedAtMs: 1_000_000
};

describe('AmbientReplayScreen', () => {
  it('renders the play control and transcript for a conversation with kept audio', () => {
    store.__set([withAudio]);
    const { getByTestId, queryAllByTestId, getByText } = render(<AmbientReplayScreen />);
    expect(getByTestId('ambient-replay-play')).toBeTruthy();
    expect(queryAllByTestId('ambient-replay-line')).toHaveLength(1);
    expect(getByText('Ship Friday.')).toBeTruthy();
  });

  it('says so when no audio was kept', () => {
    store.__set([{ ...withAudio, recordingPath: undefined, captureStartedAtMs: undefined }]);
    const { getByText } = render(<AmbientReplayScreen />);
    expect(getByText('No audio was kept for this conversation.')).toBeTruthy();
  });
});
