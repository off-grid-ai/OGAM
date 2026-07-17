/**
 * 3-dot sheet is queue-aware (rendered integration) — the Locket recorder.
 *
 * INVARIANT: the recording actions sheet must respect the SAME `isRecordingProcessing` signal every
 * other surface reads (the green card, the card sparkle's analyse gate, the detail spinner). When the
 * clip is transcribing/analysing, its queue-touching rows (Re-transcribe, Re-analyse) are disabled —
 * re-firing them would either dedup to a silent no-op or, cross-kind, redo the transcript underneath a
 * running analyse. Every non-queue row (Share/Delete) stays live regardless.
 *
 * Parameterized over the two branches so a false green can't hide: an ANALYSING clip's re-run rows are
 * disabled + show a "working…" hint; an IDLE clip's are enabled with no hint. Real Today feed + real
 * gestures (open the row's 3-dot); the clip is seeded via the store's REAL writers, its analysing state
 * via the REAL jobs/status the pipeline writes (the sanctioned device-leaf). No mocking our own code.
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

// "analysing right now" is seeded as a LIVE analyze job (the queue's real signal), not
// summaryStatus:'running' — the store's boot reconcile flips a persisted 'running' summary to 'error'
// (app-died-mid-summarize recovery), which would clobber the seed. isRecordingProcessing honors both;
// the job form is what survives deterministically in-test.
const CASES: { name: string; analysing: boolean; busy: boolean }[] = [
  { name: 'analysing now → re-run rows disabled', analysing: true, busy: true },
  { name: 'idle → re-run rows enabled', analysing: false, busy: false },
];

describe('3-dot sheet respects the shared processing signal (rendered)', () => {
  it.each(CASES)('$name', async ({ analysing, busy }) => {
    const boundary = installNativeBoundary({ fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    await installPro();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { useRecordingsStore } = require('@offgrid/pro/locket/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    useRecordingsStore.setState({ recordings: [], jobs: [] });
    const NOW = Date.now();
    // Pin to :30 of the current hour (same-bucket as NOW, always mid-bucket → never straddles a
    // boundary), full-length so it's a full card that carries the 3-dot, not a brief row.
    const midHour = new Date(NOW); midHour.setMinutes(30, 0, 0);
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt: midHour.getTime(), endedAt: midHour.getTime(),
      durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000,
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;
    // Transcribed (so Re-analyse is offered + label reads "Re-transcribe"), then the case's state.
    useRecordingsStore.getState().updateRecording(id, {
      transcript: 'alpha beta gamma', transcriptSegments: [{ text: 'alpha beta gamma', startMs: 0, endMs: 1000 }],
      transcriptStatus: 'done', transcribedAt: NOW, prunedAt: NOW,
    });
    // Analysing = this clip's single-clip analyze job is live (same shape the running-sync test uses).
    if (analysing) useRecordingsStore.setState({ jobs: [{ recordingId: `analyse:${id}`, kind: 'analyze', state: 'running' }] });

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketFeed', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component }))));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    // Today → Recordings list → this clip's 3-dot menu.
    await waitFor(() => ui.getByTestId('today-switcher'));
    await act(async () => { fireEvent.press(ui.getByTestId('today-switcher')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId('switcher-recordings'));
    await act(async () => { fireEvent.press(ui.getByTestId('switcher-recordings')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId(`today-kebab-${id}`));
    await act(async () => { fireEvent.press(ui.getByTestId(`today-kebab-${id}`)); await Promise.resolve(); });

    // The sheet is open — assert the two queue-touching rows track `busy`, the control row never does.
    await waitFor(() => ui.getByTestId('sheet-action-Re-analyse'));
    const reAnalyse = ui.getByTestId('sheet-action-Re-analyse');
    const reTranscribe = ui.getByTestId('sheet-action-Re-transcribe');
    const share = ui.getByTestId('sheet-action-Share');

    expect(!!reAnalyse.props.accessibilityState?.disabled).toBe(busy);
    expect(!!reTranscribe.props.accessibilityState?.disabled).toBe(busy);
    expect(!!share.props.accessibilityState?.disabled).toBe(false); // control rows stay live
    // The user-visible "working…" hint appears on exactly the two queue rows when busy, never when idle.
    expect(ui.queryAllByText('working…').length).toBe(busy ? 2 : 0);
  });
});
