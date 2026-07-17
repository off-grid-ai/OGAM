/**
 * Processing clip gets a GREEN card (rendered integration) — the Locket recorder feed.
 *
 * The clip being transcribed/analysed right now is called out with an accent-tinted card + a green
 * left-border, so it's spottable at a glance (on top of the "Transcribing…/Analysing…" label). Driven
 * by the SAME isRecordingProcessing signal that gates the 3-dot sheet + the analyse sparkle, so the
 * highlight and the working label can never disagree. Real Today feed; the clip's analysing state is
 * the REAL live analyze job the queue writes (the sanctioned device-leaf). No mocking our own code.
 *
 * Asserts the terminal visual: the processing card carries the green left-border (borderLeftWidth 3,
 * unique to the clipProcessing style); an idle card does not. Parameterized so both branches falsify.
 */
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

const CASES: { name: string; analysing: boolean; green: boolean }[] = [
  { name: 'analysing now → green card', analysing: true, green: true },
  { name: 'idle → plain card', analysing: false, green: false },
];

describe('processing clip shows a green card (rendered)', () => {
  it.each(CASES)('$name', async ({ analysing, green }) => {
    const boundary = installNativeBoundary({ fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { StyleSheet } = require('react-native');
    const { render, fireEvent, waitFor, act } = requireRTL();
    await installPro();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { useRecordingsStore } = require('@offgrid/pro/locket/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    useRecordingsStore.setState({ recordings: [], jobs: [] });
    const NOW = Date.now();
    const midHour = new Date(NOW); midHour.setMinutes(30, 0, 0);
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt: midHour.getTime(), endedAt: midHour.getTime(),
      durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000, // full card (not a brief row) so it's the clipCard
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;
    useRecordingsStore.getState().updateRecording(id, {
      transcript: 'alpha beta gamma', transcriptSegments: [{ text: 'alpha beta gamma', startMs: 0, endMs: 1000 }],
      transcriptStatus: 'done', transcribedAt: NOW, prunedAt: NOW,
    });
    if (analysing) useRecordingsStore.setState({ jobs: [{ recordingId: `analyse:${id}`, kind: 'analyze', state: 'running' }] });

    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () => React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { initialRouteName: 'LocketFeed', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component }))));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    await waitFor(() => ui.getByTestId('today-switcher'));
    await act(async () => { fireEvent.press(ui.getByTestId('today-switcher')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId('switcher-recordings'));
    await act(async () => { fireEvent.press(ui.getByTestId('switcher-recordings')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId(`today-clip-${id}`));

    // The green left-border (borderLeftWidth 3) is unique to the clipProcessing style — present ⇔ green.
    const card = ui.getByTestId(`today-clip-${id}`);
    const flat = StyleSheet.flatten(card.props.style);
    expect(flat.borderLeftWidth === 3).toBe(green);
  });
});
