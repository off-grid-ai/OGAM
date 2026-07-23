/**
 * The top pipeline bar reflects the CURRENT clip's live transcription percent (rendered integration).
 *
 * Before this, pipelineProgress filled from batch.done/total only, so while a single clip transcribed
 * the bar sat frozen at the 0.03 indeterminate sliver for the whole clip, then jumped when it flipped
 * done. transcriptProgressStore already carries the clip's live 0-100 percent (it's shown on the
 * per-clip card); this folds it into the transcribe-phase fraction so the bar advances WITHIN a clip.
 *
 * Real Today feed, real queue state (a running transcribe job + its batch) - the sanctioned device
 * leaf. Asserts the terminal visual: the fill View's width. Parameterized so both branches falsify -
 * with a live 50% tick the bar reads 50%; with no tick it falls back to the 3% sliver.
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

// The live case runs a MULTI-clip batch (clip 2 of 4) so the number can only be right if it is the
// CURRENT RECORDING's own percent (50%), not the batch-combined fraction (which would be (1+0.5)/4 = 38%).
const CASES: { name: string; livePct: number | null; done: number; total: number; width: string }[] = [
  { name: 'live 50% tick → bar shows the RECORDING percent (50%), not the batch fraction', livePct: 50, done: 1, total: 4, width: '50%' },
  { name: 'no live tick → falls back to the 3% sliver', livePct: null, done: 0, total: 1, width: '3%' },
];

describe('pipeline bar shows the current clip live transcription percent (rendered)', () => {
  it.each(CASES)('$name', async ({ livePct, done, total, width }) => {
    const boundary = installNativeBoundary({ fs: true });
    const React = require('react');
    const { StyleSheet } = require('react-native');
    const { render, waitFor, act, within } = requireRTL();
    await installPro();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { useRecordingsStore } = require('@offgrid/pro/locket/stores');
    const { useTranscriptProgressStore } = require('@offgrid/pro/locket/stores/transcriptProgressStore');

    useRecordingsStore.setState({ recordings: [], jobs: [] });
    useTranscriptProgressStore.setState({ byId: {} });
    const NOW = Date.now();
    const midHour = new Date(NOW); midHour.setMinutes(30, 0, 0);
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt: midHour.getTime(), endedAt: midHour.getTime(),
      durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000,
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;
    // The clip is transcribing right now: a running transcribe job + a batch pointing at it as the
    // current clip. The bar/number must track THIS clip's live percent, not the batch position.
    useRecordingsStore.getState().updateRecording(id, { transcriptStatus: 'running' });
    useRecordingsStore.setState({
      jobs: [{ recordingId: `transcribe:${id}`, kind: 'transcribe', state: 'running' }],
      transcribeBatch: { running: true, done, total, currentId: id },
    });
    if (livePct != null) useTranscriptProgressStore.getState().setProgress(id, livePct);

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketFeed', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component }))));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    // The running bar shows in BOTH feed modes (an analyse/transcribe is one global queue job).
    await waitFor(() => ui.getByTestId('today-analyse-running'));
    const bar = ui.getByTestId('today-analyse-running');
    const fill = ui.getByTestId('today-analyse-fill');
    // The bar FILLS to the blended fraction...
    expect(StyleSheet.flatten(fill.props.style).width).toBe(width);
    // ...and shows EXACTLY ONE percentage - the standalone number, never a duplicate in the label.
    if (livePct != null) {
      expect(within(bar).getByTestId('today-analyse-pct')).toBeTruthy();
      expect(within(bar).getAllByText(/50%/)).toHaveLength(1);
    } else {
      expect(within(bar).queryByTestId('today-analyse-pct')).toBeNull();
      expect(within(bar).queryByText(/%/)).toBeNull();
    }
  });
});
