/**
 * Speaker turns render on the recording DETAIL (rendered integration) — the Locket recorder.
 *
 * tdrz transcription marks voice changes with a [SPEAKER_TURN] token in the segment text. The
 * detail screen must turn those into visible "Speaker 1 / Speaker 2" labels above the transcript
 * rows. This is the screen search + a normal tap both land on (the old LocketPlayer that used to
 * render turns was removed and its mapping ported here), so this guards that the diarization
 * actually shows where the user reaches it.
 *
 * Real detail screen on a real nav stack; the recording (analysed, with tdrz segments) is seeded
 * via the store's real writers (the device-leaf). Parameterized so both branches falsify: with
 * [SPEAKER_TURN] markers the labels appear; without them, no "Speaker" label renders.
 *
 * Placement: __tests__/pro/ (the canonical home for pro-importing rendered tests).
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

const CASES: { name: string; withTurns: boolean }[] = [
  { name: 'tdrz [SPEAKER_TURN] markers → Speaker 1/2 labels', withTurns: true },
  { name: 'no markers → no speaker labels', withTurns: false },
];

describe('speaker turns on the recording detail (rendered)', () => {
  it.each(CASES)('$name', async ({ withTurns }) => {
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
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt: NOW, endedAt: NOW,
      durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000,
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;
    // A [SPEAKER_TURN] on the middle segment flips the speaker, so the first row reads "Speaker 1"
    // and the last "Speaker 2". Analysed (on-device) so the detail shows its transcript body rather
    // than the Analyse CTA. The stripped segment text stays non-empty so the rows render.
    const turn = withTurns ? ' [SPEAKER_TURN]' : '';
    useRecordingsStore.getState().updateRecording(id, {
      transcript: 'alpha. beta. gamma.',
      transcriptStatus: 'done', transcribedAt: NOW, prunedAt: NOW,
      transcriptSegments: [
        { text: 'alpha.', startMs: 0, endMs: 1000 },
        { text: `beta.${turn}`, startMs: 1000, endMs: 2000 },
        { text: 'gamma.', startMs: 2000, endMs: 3000 },
      ],
      insightsSource: 'on-device', insightsAt: 1, title: 'T', summary: 'S', keyPoints: ['k'],
      actionItems: [{ id: 'a', text: 'x' }],
    } as never);

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketRecording', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, {
            key: sc.name, name: sc.name, component: sc.component,
            initialParams: sc.name === 'LocketRecording' ? { recordingId: id } : undefined,
          }))));
    const ui = render(React.createElement(App));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Transcript is collapsed by default — expand it so the segment rows (+ speaker labels) render.
    await waitFor(() => ui.getByTestId('insights-toggle-transcript'));
    await act(async () => { fireEvent.press(ui.getByTestId('insights-toggle-transcript')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId('transcript-seg-0'));

    // The terminal artifact: visible "Speaker N" labels iff the tdrz markers were present.
    expect(ui.queryByText('Speaker 1') != null).toBe(withTurns);
    expect(ui.queryByText('Speaker 2') != null).toBe(withTurns);
  });
});
