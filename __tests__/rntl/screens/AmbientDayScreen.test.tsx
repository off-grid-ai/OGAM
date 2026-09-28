/**
 * The Day view home: renders the journal, the day's tasks (checkable, toggling the store) and the
 * timeline from the store; shows the empty state when the day has nothing; and records from the FAB.
 * Capture + generation are mocked (hook, journal, ask) so the screen is exercised without a device.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
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
const mockProcessPending = jest.fn(async () => {});
let mockCaptureError: string | null = null; // per-test override for the capture hook's error field
jest.mock('../../../src/hooks/useAmbientCapture', () => ({
  useAmbientCapture: () => ({
    phase: 'idle', recording: false, processing: false, liveCount: 0, elapsedMs: 0,
    flagCount: 0, progress: null, error: mockCaptureError, start: mockStart, stop: jest.fn(), flag: jest.fn(), processPending: mockProcessPending
  }),
  processPending: mockProcessPending,
  currentCapturePhase: () => 'idle'
}));
// Pre-record memory pre-check: default to "fits" so existing record tests don't trip the warning.
jest.mock('../../../src/services/modelServices/residencyIntents', () => ({
  mobileResidencyIntents: {
    canPreloadText: jest.fn(async () => true),
    canPreloadTranscription: jest.fn(() => true)
  }
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

import { Alert } from 'react-native';
import { AmbientDayScreen } from '../../../src/screens/AmbientDayScreen';
import { useAmbientTimelineStore } from '../../../src/stores/ambientTimelineStore';
import { mobileSpeechInputPorts } from '../../../src/services/adapters/speech/mobileSpeechInputPorts';
import { mobileTextEngineControl } from '../../../src/services/modelServices/textEngineControl';
import { mobileResidencyIntents } from '../../../src/services/modelServices/residencyIntents';
import * as mobileLLMService from '../../../src/services/modelServices/mobileLLMService';
import * as macStt from '../../../src/services/ambient/macSttExecutorFactory';
import * as modelState from '../../../src/services/modelServices/modelState';
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
    mockCaptureError = null;
    store.__set({ sessions: [], doneTaskIds: [], journalByDay: {}, actionsByDay: {}, pendingCaptures: [], processingMode: 'live', audioRetentionDays: 7, onboardingComplete: true, useMacForTranscription: false, onDeviceOnly: false });
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
    // The timeline detail now lives behind the Timeline chip; open it to see the day's rows.
    expect(getByText('1 conversation')).toBeTruthy();
    fireEvent.press(getByTestId('ambient-open-timeline'));
    expect(queryAllByTestId('ambient-timeline-row')).toHaveLength(1);
  });

  it('toggles a task through the store', () => {
    store.__set({ sessions: [session('s1')] });
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-task-box'));
    expect(mockToggle).toHaveBeenCalledWith('s1#0');
  });

  it('starts recording from the mic button', async () => {
    // Recording now gates on the new-contract readiness ports: a ready transcriber + text engine
    // let the FAB start directly instead of raising the "before you record" warning.
    const rdy = jest.spyOn(mobileSpeechInputPorts.transcriber, 'ready').mockReturnValue(true);
    const txt = jest.spyOn(mobileTextEngineControl, 'isReady').mockReturnValue(true);
    try {
      const { getByTestId } = render(<AmbientDayScreen />);
      await act(async () => {
        fireEvent.press(getByTestId('ambient-day-record'));
      });
      expect(mockStart).toHaveBeenCalledTimes(1);
    } finally {
      rdy.mockRestore();
      txt.mockRestore();
    }
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
    fireEvent.press(getByTestId('ambient-empty-settings')); // settings now live behind the gear
    fireEvent.press(getByTestId('ambient-mode-nightly'));
    expect(mockSetMode).toHaveBeenCalledWith('nightly');
  });

  it('changes the audio retention window', () => {
    const { getByTestId } = render(<AmbientDayScreen />);
    fireEvent.press(getByTestId('ambient-empty-settings')); // settings now live behind the gear
    fireEvent.press(getByTestId('ambient-retention-30'));
    expect(mockSetRetention).toHaveBeenCalledWith(30);
  });

  it('shows on the home screen whether the phone or the Mac will transcribe', () => {
    const rdy = jest.spyOn(mobileSpeechInputPorts.transcriber, 'ready');
    const mac = jest.spyOn(macStt, 'macOffloadReady');
    const route = jest.spyOn(mobileLLMService, 'activeMobileRoute');
    route.mockReturnValue({ modality: 'transcription', model: null } as any);
    try {
      // Local model loaded, Mac not reachable → on this phone.
      rdy.mockReturnValue(true);
      mac.mockReturnValue(false);
      const phone = render(<AmbientDayScreen />);
      expect(phone.getByTestId('ambient-transcription-source')).toHaveTextContent(
        'Transcribing on this phone'
      );
      phone.unmount();

      // No local model, Mac enabled + reachable → on your Mac.
      rdy.mockReturnValue(false);
      mac.mockReturnValue(true);
      store.__set({ useMacForTranscription: true, onDeviceOnly: false });
      const remote = render(<AmbientDayScreen />);
      expect(remote.getByTestId('ambient-transcription-source')).toHaveTextContent(
        'Transcribing on your Mac'
      );
      remote.unmount();

      // Nothing available → not set up.
      rdy.mockReturnValue(false);
      mac.mockReturnValue(false);
      store.__set({ useMacForTranscription: false });
      const none = render(<AmbientDayScreen />);
      expect(none.getByTestId('ambient-transcription-source')).toHaveTextContent(
        /No transcription set up/
      );
    } finally {
      rdy.mockRestore();
      mac.mockRestore();
      route.mockRestore();
    }
  });

  it('turns the pending banner into a Retry that shows why processing failed', () => {
    mockCaptureError = 'Not enough memory to load the model.';
    store.__set({ pendingCaptures: [{ id: '1' }] });
    const { getByTestId } = render(<AmbientDayScreen />);
    const banner = getByTestId('ambient-process-pending');
    expect(banner).toHaveTextContent(/Not enough memory to load the model\./);
    expect(banner).toHaveTextContent(/Retry/);
    fireEvent.press(banner);
    expect(mockProcessPending).toHaveBeenCalledTimes(1);
  });

  it('warns about memory before recording when relying on the phone and it is tight', async () => {
    const rdy = jest.spyOn(mobileSpeechInputPorts.transcriber, 'ready').mockReturnValue(true);
    const txt = jest.spyOn(mobileTextEngineControl, 'isReady').mockReturnValue(true);
    const textId = jest.spyOn(modelState, 'selectedTextModelId').mockReturnValue('text-model');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (mobileResidencyIntents.canPreloadText as jest.Mock).mockResolvedValueOnce(false);
    try {
      const { getByTestId } = render(<AmbientDayScreen />);
      await act(async () => {
        fireEvent.press(getByTestId('ambient-day-record'));
      });
      expect(alert).toHaveBeenCalledWith('Low on memory', expect.any(String), expect.any(Array));
      expect(mockStart).not.toHaveBeenCalled(); // recording is gated behind the warning
    } finally {
      rdy.mockRestore();
      txt.mockRestore();
      textId.mockRestore();
      alert.mockRestore();
    }
  });
});
