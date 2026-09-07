/**
 * The timeline surface: empty state, a captured conversation rendered as a day-grouped card (title,
 * headline, chips), and the capture control (Record starts the recorder; Stop builds sessions and
 * writes them to the store). The build pipeline itself is unit-tested; here we prove the screen wires
 * to it and renders the store.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) };
});

jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb',
    surface: '#111', border: '#333', error: '#f00', primary: '#34D399'
  };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} }) };
});

const mockStart = jest.fn(async (_s: (seg: { startMs: number; endMs: number }) => void) => {});
const mockStop = jest.fn<Promise<{ path: string; durationSeconds: number } | null>, []>(async () => null);
jest.mock('../../../src/utils/haptics', () => ({ triggerHaptic: jest.fn() }));
const mockAsk = jest.fn(async () => ({ answer: '', sources: [] as any[], status: 'no-matches' }));
jest.mock('../../../src/services/ambient/askDayFactory', () => ({
  askDayWithDeviceLLM: (...args: unknown[]) => mockAsk(...(args as [])),
}));
jest.mock('../../../src/services/ambient/ambientRecorderFactory', () => ({
  createAmbientRecorder: () => ({ start: mockStart, stop: mockStop, phaseNow: () => 'idle' })
}));

const mockBuild = jest.fn(async () => [] as unknown[]);
jest.mock('../../../src/services/ambient/timelineBuilder', () => ({
  buildTimelineSessions: (...args: unknown[]) => mockBuild(...(args as [])),
}));
jest.mock('../../../src/services/ambient/timelineBuilderFactory', () => ({
  createDefaultTimelineBuildDeps: () => ({})
}));
jest.mock('../../../src/services/ambient/phoneSttExecutorFactory', () => ({
  ensureAmbientSliceDir: jest.fn(async () => {})
}));

const mockAddSessions = jest.fn();
const mockSetOnDeviceOnly = jest.fn();
jest.mock('../../../src/stores/ambientTimelineStore', () => {
  let sessions: unknown[] = [];
  let onDeviceOnly = false;
  const state = () => ({
    sessions,
    onDeviceOnly,
    addSessions: mockAddSessions,
    setOnDeviceOnly: (v: boolean) => {
      onDeviceOnly = v;
      mockSetOnDeviceOnly(v);
    }
  });
  return {
    useAmbientTimelineStore: Object.assign(
      (selector: (s: ReturnType<typeof state>) => unknown) => selector(state()),
      {
        getState: state,
        __set: (next: unknown[]) => {
          sessions = next;
        }
      }
    )
  };
});

jest.mock('../../../src/services/adapters/speech/mobileSpeechInputPorts', () => ({
  mobileSpeechInputPorts: { transcriber: { ready: () => true } }
}));

import { AmbientTimelineScreen } from '../../../src/screens/AmbientTimelineScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';

const storeMock = useAmbientTimelineStore as unknown as { __set: (s: unknown[]) => void };

const session = (over: Partial<any> = {}) => ({
  id: 's1',
  startMs: Date.now(),
  endMs: Date.now() + 180000,
  speechMs: 180000,
  summary: {
    title: 'Standup with Priya',
    headline: 'Agreed to ship ambient by Friday.',
    decisions: ['Ship Friday'],
    actionItems: ['Fix the build', 'Send PO'],
    people: ['Priya']
  },
  segments: [],
  summaryStatus: 'ok',
  flaggedSegmentIds: [],
  ...over
});

describe('AmbientTimelineScreen', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockStop.mockClear();
    mockBuild.mockClear();
    mockAddSessions.mockClear();
    mockSetOnDeviceOnly.mockClear();
    storeMock.__set([]);
    mockAsk.mockReset();
    mockAsk.mockResolvedValue({ answer: '', sources: [], status: 'no-matches' });
  });

  it('shows the empty state when nothing is captured', () => {
    const { getByTestId } = render(<AmbientTimelineScreen />);
    expect(getByTestId('ambient-timeline-empty')).toBeTruthy();
  });

  it('renders a captured conversation as a card with headline and chips', () => {
    storeMock.__set([session()]);
    const { getByTestId, getByText, queryAllByTestId } = render(<AmbientTimelineScreen />);
    expect(queryAllByTestId('ambient-session-card')).toHaveLength(1);
    expect(getByTestId('ambient-card-headline')).toHaveTextContent('Agreed to ship ambient by Friday.');
    expect(getByText('Standup with Priya')).toBeTruthy();
    expect(getByText('1 decision')).toBeTruthy();
    expect(getByText('2 actions')).toBeTruthy();
    expect(getByText('1 person')).toBeTruthy();
    expect(getByText('TODAY')).toBeTruthy();
  });

  it('shows the summary status hint when a card has no headline', () => {
    storeMock.__set([
      session({
        summary: { title: 'Conversation', headline: '', decisions: [], actionItems: [], people: [] },
        summaryStatus: 'no-model'
      })
    ]);
    const { getByTestId } = render(<AmbientTimelineScreen />);
    expect(getByTestId('ambient-card-headline')).toHaveTextContent('Load a chat model in Models for summaries');
  });

  it('starts the recorder on Record', async () => {
    const { getByTestId } = render(<AmbientTimelineScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId('ambient-capture-toggle')).toHaveTextContent('Stop'));
  });

  it('shows a skeleton and live progress while processing a capture', async () => {
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    // Hold the build open, and capture the onProgress the screen passes in.
    let onProgress: ((p: any) => void) | undefined;
    let resolveBuild: (v: unknown[]) => void = () => {};
    mockBuild.mockImplementationOnce((...args: any[]) => {
      onProgress = args[3]?.onProgress;
      return new Promise(res => {
        resolveBuild = res;
      });
    });
    const { getByTestId } = render(<AmbientTimelineScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    // Processing: skeleton visible, and the status reflects the emitted progress.
    expect(getByTestId('ambient-skeleton')).toBeTruthy();
    act(() => onProgress?.({ phase: 'summarizing', done: 0, total: 2 }));
    expect(getByTestId('ambient-status')).toHaveTextContent(/Summarising 1 of 2/);
    await act(async () => {
      resolveBuild([]);
    });
  });

  it('on Stop, builds sessions from the capture and writes them to the store', async () => {
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    mockBuild.mockResolvedValueOnce([session()]);
    const { getByTestId } = render(<AmbientTimelineScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockAddSessions).toHaveBeenCalledTimes(1);
  });

  it('offers a Flag button only while recording, and records anchors on tap', async () => {
    const { getByTestId, queryByTestId } = render(<AmbientTimelineScreen />);
    expect(queryByTestId('ambient-flag')).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    const flag = getByTestId('ambient-flag');
    expect(flag).toHaveTextContent(/Flag this moment/);
    act(() => fireEvent.press(flag));
    expect(getByTestId('ambient-flag')).toHaveTextContent(/Flagged 1/);
  });

  it('passes recorded anchors to the build', async () => {
    mockStop.mockResolvedValueOnce({ path: '/rec.wav', durationSeconds: 3 });
    mockBuild.mockResolvedValueOnce([]);
    const { getByTestId } = render(<AmbientTimelineScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    const sink = mockStart.mock.calls[0][0] as (s: { startMs: number; endMs: number }) => void;
    act(() => sink({ startMs: 0, endMs: 900 }));
    act(() => fireEvent.press(getByTestId('ambient-flag')));
    await act(async () => {
      fireEvent.press(getByTestId('ambient-capture-toggle'));
    });
    // buildTimelineSessions(captured, path, startedAt, deps, anchorsMs) — anchors is the 5th arg
    const anchors = (mockBuild.mock.calls[0] as any[])[4];
    expect(Array.isArray(anchors)).toBe(true);
    expect(anchors).toHaveLength(1);
  });

  it('shows a flagged chip on a card that has anchors', () => {
    storeMock.__set([session({ flaggedSegmentIds: ['x', 'y'] })]);
    const { getByTestId } = render(<AmbientTimelineScreen />);
    expect(getByTestId('ambient-card-flag')).toHaveTextContent('2 flagged');
  });

  it('answers an ask-your-day question and links its sources', async () => {
    const src = session({ id: 's9', summary: { title: 'Standup', headline: 'x', decisions: [], actionItems: [], people: [] } });
    storeMock.__set([src]);
    mockAsk.mockResolvedValue({ answer: 'You ship Friday.', sources: [src], status: 'ok' });
    const { getByTestId, getByText, queryAllByTestId } = render(<AmbientTimelineScreen />);
    fireEvent.changeText(getByTestId('ambient-ask-input'), 'when do we ship?');
    await act(async () => {
      fireEvent(getByTestId('ambient-ask-input'), 'submitEditing');
    });
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(getByText('You ship Friday.')).toBeTruthy();
    expect(queryAllByTestId('ambient-ask-source')).toHaveLength(1);
  });

  it('toggles the keep-summaries-on-device privacy switch', () => {
    storeMock.__set([session()]);
    const { getByTestId } = render(<AmbientTimelineScreen />);
    fireEvent(getByTestId('ambient-privacy-switch'), 'valueChange', true);
    expect(mockSetOnDeviceOnly).toHaveBeenCalledWith(true);
  });
});
