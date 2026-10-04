/**
 * AmbientScreen probe — the capture harness renders, starts the recorder, turns emitted segments
 * into rows, and stops. Driven through a fake AmbientRecorder (the factory is mocked) so the screen
 * is exercised without a microphone. Feather + safe-area come from the global jest.setup mocks.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }) };
});

jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000',
    text: '#fff',
    textMuted: '#999',
    surface: '#111',
    border: '#333',
    error: '#f00',
    primary: '#1DB954'
  };
  return {
    useTheme: () => ({ colors, isDark: true }),
    useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} })
  };
});

const mockStart = jest.fn(async (_onSegment: (s: { startMs: number; endMs: number }) => void) => {});
const mockStop = jest.fn<Promise<{ path: string; durationSeconds: number } | null>, []>(
  async () => null
);
jest.mock('../../../src/services/ambient/ambientRecorderFactory', () => ({
  createAmbientRecorder: () => ({ start: mockStart, stop: mockStop, phaseNow: () => 'idle' })
}));

const mockTranscribe = jest.fn(async (_deps: unknown) => [] as Array<Record<string, unknown>>);
jest.mock('../../../src/services/ambient/phoneSttExecutorFactory', () => ({
  createDefaultPhoneSttExecutor: () => ({ transcribe: jest.fn() }),
  ensureAmbientSliceDir: jest.fn(async () => {})
}));
jest.mock('../../../src/services/ambient/ambientCaptureSession', () => ({
  probeTranscribeSegments: (segments: unknown, recordingPath: unknown, executor: unknown) =>
    mockTranscribe({ segments, recordingPath, executor })
}));

jest.mock('../../../src/services/adapters/speech/mobileSpeechInputPorts', () => {
  let ready = true;
  return {
    mobileSpeechInputPorts: { transcriber: { ready: () => ready } },
    __setReady: (v: boolean) => {
      ready = v;
    }
  };
});

import { AmbientScreen } from '../../../src/screens/AmbientScreen';
import * as speechPort from '../../../src/services/adapters/speech/mobileSpeechInputPorts';

const speechMock = speechPort as unknown as { __setReady: (v: boolean) => void };

describe('AmbientScreen', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockStop.mockClear();
    mockTranscribe.mockReset();
    mockTranscribe.mockResolvedValue([]);
    speechMock.__setReady(true);
  });

  it('offers Start, and starts the recorder on press', async () => {
    const { getByTestId } = render(<AmbientScreen />);
    expect(getByTestId('ambient-toggle')).toHaveTextContent('Start recording');
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId('ambient-toggle')).toHaveTextContent('Stop'));
  });

  it('renders a row for each emitted speech segment', async () => {
    const { getByTestId, queryAllByTestId } = render(<AmbientScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;

    act(() => sink({ startMs: 0, endMs: 900 }));
    act(() => sink({ startMs: 1600, endMs: 2100 }));

    expect(queryAllByTestId('ambient-segment')).toHaveLength(2);
    expect(getByTestId('ambient-count')).toHaveTextContent('2 segments · listening');
  });

  it('stops the recorder from the Stop button', async () => {
    const { getByTestId } = render(<AmbientScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    await waitFor(() => expect(getByTestId('ambient-toggle')).toHaveTextContent('Stop'));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId('ambient-toggle')).toHaveTextContent('Start recording'));
  });
  it('transcribes the capture on stop and shows each segment\'s text', async () => {
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    mockTranscribe.mockResolvedValueOnce([
      { id: '0-900', startMs: 0, endMs: 900, transcript: 'hello there', error: null }
    ]);
    const { getByTestId, queryAllByTestId } = render(<AmbientScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));

    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });

    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    const passed = mockTranscribe.mock.calls[0][0] as { segments: unknown[]; recordingPath: string };
    expect(passed.recordingPath).toBe('/rec.wav');
    expect(passed.segments).toHaveLength(1);
    await waitFor(() => {
      const texts = queryAllByTestId('ambient-transcript');
      expect(texts).toHaveLength(1);
      expect(texts[0]).toHaveTextContent('hello there');
    });
  });
  it('tells the user to set up a model when transcription is not ready, and does not transcribe', async () => {
    speechMock.__setReady(false);
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    const { getByTestId, findByText } = render(<AmbientScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(await findByText(/Set up a transcription model/i)).toBeTruthy();
  });

  it('shows the per-segment failure reason instead of a silent blank', async () => {
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    mockTranscribe.mockResolvedValueOnce([
      { id: '0-900', startMs: 0, endMs: 900, transcript: null, error: 'No Whisper model loaded' }
    ]);
    const { getByTestId, findByTestId } = render(<AmbientScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-toggle'));
    });
    const err = await findByTestId('ambient-segment-error');
    expect(err).toHaveTextContent('No Whisper model loaded');
    expect(await findByTestId('ambient-capture-info')).toBeTruthy();
  });
});
