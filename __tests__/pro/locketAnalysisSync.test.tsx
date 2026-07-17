/**
 * Cross-screen analysis-state sync (rendered integration) — the Locket recorder.
 *
 * INVARIANT (docs/plans/analysis-state-sync-diagnosis-and-fix.md §3): the SAME recording must read
 * the SAME analysis verdict on every surface. "analysed" ⇔ an LLM pass ran (on-device OR remote,
 * engine is provenance); the extractive keyword floor + a transcribed-only clip are NOT analysed.
 *
 * This parameterizes ONE rendered flow over every resting state a post-transcription clip can be in,
 * asserting the Today list and the detail screen AGREE in each. It is the wiring guard that complements
 * the pure-derivation guard in pro/__tests__/unit/recordingStatusTotality.test.ts (which proves statusOf
 * is total + correct for the whole cartesian product). Together: derivation correct (unit) + every
 * surface reads through it (this). Real screens + real navigation; fakes only at the device boundary;
 * no mocking our own code — the recording is seeded via the store's REAL writers (the recorder finalized
 * a clip; the pipeline/extractive floor / LLM pass wrote its facts — the sanctioned device-leaf).
 *
 * The `extractive` and `remote` rows are the two the first RPS refactor got wrong (extractive read
 * analysed on the detail via insightsAt; remote read not-analysed on Today via `=== 'on-device'`), so
 * they are the load-bearing rows.
 *
 * Placement: __tests__/pro/ (core jest ignores <rootDir>/pro/); this is the canonical home for
 * pro-importing rendered tests (jest.config proDependentTestPaths).
 */
// Un-mock react-navigation for THIS file: jest.setup stubs it globally (navigate no-op, useRoute {}),
// which breaks real cross-screen navigation + route params. requireActual restores the real library —
// the opposite of mocking our code — so a genuine Today → detail push carries the recordingId.
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

type Facts = Record<string, unknown>;
// Each resting state + the SINGLE correct cross-screen verdict. analysed ⇔ an LLM source.
const STATES: { name: string; facts: Facts; analysed: boolean }[] = [
  { name: 'transcribed (no insights)', facts: {}, analysed: false },
  { name: 'extractive floor only', facts: { insightsSource: 'extractive', insightsAt: 1, title: 'T', actionItems: [{ id: 'a', text: 'x' }] }, analysed: false },
  { name: 'analysed on-device', facts: { insightsSource: 'on-device', insightsAt: 1, title: 'T', summary: 'S', keyPoints: ['k'], actionItems: [{ id: 'a', text: 'x' }] }, analysed: true },
  { name: 'analysed remote', facts: { insightsSource: 'remote', insightsAt: 1, title: 'T', summary: 'S', keyPoints: ['k'], actionItems: [{ id: 'a', text: 'x' }] }, analysed: true },
];

describe('cross-screen analysis sync (rendered): every state reads the SAME on Today + detail', () => {
  it.each(STATES)('$name → both surfaces agree', async ({ facts, analysed: expected }) => {
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

    // Fresh store per case so the day's counts/rows are only this recording.
    useRecordingsStore.setState({ recordings: [], jobs: [] });

    // --- Precondition via the REAL store writers (device-leaf) ---------------------------------
    const NOW = Date.now();
    boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
    useRecordingsStore.getState().addFinalized({
      path: '/docs/rec.wav', startedAt: NOW, endedAt: NOW,
      durationMs: 30 * 60 * 1000, // full card (past briefMaxMs) → the row shows the analyse sparkle when not analysed
      sizeBytes: 5_000_000,
    });
    const id: string = useRecordingsStore.getState().recordings[0].id;
    // Every case is post-transcription (analysed-ness is only meaningful once transcribed).
    useRecordingsStore.getState().updateRecording(id, {
      transcript: "Ship the release Friday and email the team.",
      transcriptSegments: [{ text: 'Ship the release Friday and email the team.', startMs: 0, endMs: 5000 }],
      transcriptStatus: 'done', transcribedAt: NOW, prunedAt: NOW,
    });
    if (Object.keys(facts).length) useRecordingsStore.getState().updateRecording(id, facts as never);

    // --- Mount the real screens on the real nav stack -----------------------------------------
    const Stack = createNativeStackNavigator();
    const screens = getRegisteredScreens();
    const App = () =>
      React.createElement(NavigationContainer, null,
        React.createElement(Stack.Navigator,
          { initialRouteName: 'LocketFeed', screenOptions: { headerShown: false } },
          ...screens.map((sc: { name: string; component: React.ComponentType }) =>
            React.createElement(Stack.Screen, { key: sc.name, name: sc.name, component: sc.component })),
        ));
    const ui = render(React.createElement(App));
    await act(async () => { await Promise.resolve(); });

    // --- Surface 1: Today "Recordings" (day) list ---------------------------------------------
    await waitFor(() => ui.getByTestId('today-switcher'));
    await act(async () => { fireEvent.press(ui.getByTestId('today-switcher')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId('switcher-recordings'));
    await act(async () => { fireEvent.press(ui.getByTestId('switcher-recordings')); await Promise.resolve(); });
    await waitFor(() => ui.getByTestId(`today-clip-${id}`));
    // sparkle present ⇔ list offers to analyse it ⇔ list reads NOT analysed.
    const todayAnalysed = ui.queryByTestId(`today-analyse-${id}`) == null;

    // --- Surface 2: the per-recording detail screen -------------------------------------------
    await act(async () => { fireEvent.press(ui.getByTestId(`today-clip-${id}`)); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => ui.getByTestId('insights-overflow'));
    const offersAnalyse = ui.queryByTestId('insights-generate') != null || ui.queryByTestId('insights-analyse') != null;
    const showsAnalysedBody = ui.queryByTestId('insights-regenerate') != null;
    expect(offersAnalyse !== showsAnalysedBody).toBe(true); // decisive: exactly one, so a false green can't hide
    const detailAnalysed = showsAnalysedBody;

    // --- The invariant: same recording, same verdict on both, matching the domain expectation --
    process.stderr.write(`[SYNC ${JSON.stringify(facts)}] today=${todayAnalysed} detail=${detailAnalysed} expected=${expected}\n`);
    expect({ today: todayAnalysed, detail: detailAnalysed }).toEqual({ today: expected, detail: expected });
  });
});

describe('cross-screen RUNNING sync (rendered): analysing clip A must not desync clip B', () => {
  it('while A is being analysed, B stays analysable on BOTH Today and its detail', async () => {
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
    // Pin both clips to :30 / :29 of the CURRENT hour: distinct startedAt (addFinalized dedups by
    // startedAt, so identical times collapse to one), yet the same hour → same time-of-day bucket as
    // NOW (the bucket the feed expands), always mid-bucket so they can never straddle a boundary.
    // Deterministic regardless of wall-clock. Full-length (30 min) so neither folds into a brief group.
    const midHour = new Date(NOW); midHour.setMinutes(30, 0, 0);
    const T = midHour.getTime();
    ['/docs/a.wav', '/docs/b.wav'].forEach((p, i) => {
      boundary.fs!.seedFile(p, 5_000_000);
      useRecordingsStore.getState().addFinalized({ path: p, startedAt: T - i * 60_000, endedAt: T - i * 60_000, durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000 });
    });
    const ids: string[] = useRecordingsStore.getState().recordings.map((r: { id: string }) => r.id);
    ids.forEach((id) => useRecordingsStore.getState().updateRecording(id, {
      transcript: 'alpha beta gamma', transcriptSegments: [{ text: 'alpha beta gamma', startMs: 0, endMs: 1000 }],
      transcriptStatus: 'done', transcribedAt: NOW, prunedAt: NOW,
    }));
    const [a, b] = ids;
    // Clip A is being analysed right now (its single-clip analyse job is live); B is untouched.
    useRecordingsStore.setState({ jobs: [{ recordingId: `analyse:${a}`, kind: 'analyze', state: 'running' }] });

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
    await waitFor(() => ui.getByTestId(`today-clip-${b}`));

    // Today: A (being analysed) shows no sparkle; B (untouched) STILL shows its sparkle.
    // On HEAD, Today gated the sparkle on the GLOBAL analyse state, so B's sparkle was wrongly hidden
    // while A analysed — the desync this guards.
    const todayB = ui.queryByTestId(`today-analyse-${b}`) != null; // present ⇔ analysable
    const todayA = ui.queryByTestId(`today-analyse-${a}`) != null;
    process.stderr.write(`[RUN-SYNC] todayA_sparkle=${todayA} todayB_sparkle=${todayB}\n`);
    expect(todayA).toBe(false); // A is being analysed → no sparkle
    expect(todayB).toBe(true);  // B untouched → sparkle stays (the fix)

    // Cross-screen: B's detail offers Analyse (consistent with Today's sparkle), not a spinner.
    await act(async () => { fireEvent.press(ui.getByTestId(`today-clip-${b}`)); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => ui.getByTestId('insights-overflow'));
    const detailBOffersAnalyse = ui.queryByTestId('insights-generate') != null || ui.queryByTestId('insights-analyse') != null;
    expect(detailBOffersAnalyse).toBe(true); // detail agrees B is analysable → consistent with Today's sparkle
  });
});
