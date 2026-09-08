/**
 * The Day view home: renders the journal, the day's tasks (checkable, toggling the store) and the
 * timeline from the store; shows the empty state when the day has nothing; and records from the FAB.
 * Capture + generation are mocked (hook, journal, ask) so the screen is exercised without a device.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Share } from 'react-native';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn() }) };
});
jest.mock('../../../src/theme', () => {
  const colors = {
    background: '#000', text: '#fff', textMuted: '#999', textSecondary: '#bbb',
    surface: '#111', border: '#333', error: '#f00', primary: '#34D399'
  };
  return { useTheme: () => ({ colors, isDark: true }), useThemedStyles: (fn: any) => fn(colors, { small: {}, medium: {}, large: {} }) };
});

const mockStart = jest.fn();
const mockProcessPending = jest.fn();
jest.mock('../../../src/hooks/useAmbientCapture', () => ({
  useAmbientCapture: () => ({
    phase: 'idle', recording: false, processing: false, liveCount: 0, elapsedMs: 0,
    flagCount: 0, progress: null, error: null, start: mockStart, stop: jest.fn(), flag: jest.fn(), processPending: mockProcessPending
  })
}));
jest.mock('../../../src/services/ambient/journalFactory', () => ({
  journalForDay: jest.fn(async () => ({ text: '', status: 'no-speech' }))
}));
jest.mock('../../../src/services/ambient/askDayFactory', () => ({
  askDayWithDeviceLLM: jest.fn(async () => ({ answer: '', sources: [], status: 'no-matches' }))
}));
jest.mock('../../../src/services/ambient/actionsFactory', () => ({
  proposeActionsForDay: jest.fn(async () => ({ proposals: [], status: 'no-speech' }))
}));
jest.mock('../../../src/services/ambient/retentionService', () => ({
  runAudioRetention: jest.fn(async () => 0)
}));

const mockToggle = jest.fn();
const mockResolveAction = jest.fn();
const mockSetMode = jest.fn();
const mockSetRetention = jest.fn();
jest.mock('../../../src/stores/ambientTimelineStore', () => {
  let state: any = {
    sessions: [], doneTaskIds: [], journalByDay: {}, actionsByDay: {}, onDeviceOnly: false,
    pendingCaptures: [], processingMode: 'live', audioRetentionDays: 7,
    onboardingComplete: true,
    toggleTask: (id: string) => mockToggle(id),
    setDayActions: jest.fn(),
    resolveDayAction: (dayKey: string, i: number) => mockResolveAction(dayKey, i),
    setProcessingMode: (m: string) => mockSetMode(m),
    setOnDeviceOnly: jest.fn(),
    setAudioRetentionDays: (d: number) => mockSetRetention(d),
    setOnboardingComplete: jest.fn(), setCaptureMode: jest.fn()
  };
  const hook = (selector: any) => selector(state);
  hook.getState = () => state;
  hook.__set = (patch: any) => { state = { ...state, ...patch }; };
  return { useAmbientTimelineStore: hook };
});

import { AmbientDayScreen } from '../../../src/screens/AmbientDayScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';
const store = useAmbientTimelineStore as any;

const now = Date.now();
const session = (id: string, over: any = {}) => ({
  id, startMs: now, endMs: now + 1000, speechMs: 1000,
  summary: { title: 'Standup', headline: 'Ship Friday.', decisions: [], actionItems: ['Fix the build'], people: ['Priya'] },
  summaryStatus: 'ok', flaggedSegmentIds: [], segments: [], ...over
});

describe('AmbientDayScreen', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockToggle.mockClear();
    mockResolveAction.mockClear();
    mockProcessPending.mockClear();
    mockSetMode.mockClear();
    mockSetRetention.mockClear();
    store.__set({ sessions: [], doneTaskIds: [], journalByDay: {}, actionsByDay: {}, pendingCaptures: [], processingMode: 'live', audioRetentionDays: 7, onboardingComplete: true });
  });

  it('shows the empty state when the day has nothing', () => {
    const { getByTestId } = render(<AmbientDayScreen />);
    expect(getByTestId('ambient-day-empty')).toBeTruthy();
  });

  it('renders the journal, tasks and timeline for the day', () => {
    const today = new Date(now);
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    store.__set({ sessions: [session('s1')], journalByDay: { [key]: 'A build-focused day.' } });
    const { getByTestId, queryAllByTestId, getByText } = render(<AmbientDayScreen />);
    expect(getByTestId('ambient-journal')).toHaveTextContent('A build-focused day.');
    expect(queryAllByTestId('ambient-task')).toHaveLength(1);
    expect(getByText('Fix the build')).toBeTruthy();
    expect(queryAllByTestId('ambient-timeline-row')).toHaveLength(1);
  });

  it('toggles a task through the store', () => {
    store.__set({ sessions: [session('s1')] });
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-task-box'));
    expect(mockToggle).toHaveBeenCalledWith('s1#0');
  });

  it('starts recording from the mic button', () => {
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-day-record'));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('renders cached actions and approves one (shares + resolves)', () => {
    const today = new Date(now);
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    store.__set({
      sessions: [session('s1')],
      actionsByDay: { [key]: [{ title: 'Message Priya the build', connector: 'Messages', why: 'you committed' }] }
    });
    const { getByTestId, queryAllByTestId } = render(<AmbientDayScreen />);
    expect(queryAllByTestId('ambient-action')).toHaveLength(1);
    fireEvent.press(getByTestId('ambient-action-approve'));
    expect(shareSpy).toHaveBeenCalledWith({ message: 'Message Priya the build — you committed' });
    expect(mockResolveAction).toHaveBeenCalledWith(key, 0);
    shareSpy.mockRestore();
  });

  it('shows a pending banner and processes the queue', () => {
    store.__set({ pendingCaptures: [{ id: '1' }, { id: '2' }] });
    const { getByTestId, getByText } = render(<AmbientDayScreen />);
    expect(getByText('2 recordings waiting')).toBeTruthy();
    fireEvent.press(getByTestId('ambient-process-pending'));
    expect(mockProcessPending).toHaveBeenCalledTimes(1);
  });

  it('switches the processing mode', () => {
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-mode-nightly'));
    expect(mockSetMode).toHaveBeenCalledWith('nightly');
  });

  it('changes the audio retention window', () => {
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-retention-30'));
    expect(mockSetRetention).toHaveBeenCalledWith(30);
  });
});
