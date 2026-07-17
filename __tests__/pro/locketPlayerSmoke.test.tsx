/**
 * LocketPlayerScreen smoke (rendered integration) — behaviour-neutrality guard for the
 * component decomposition (docs/plans/locket-screens-refactor.md phases B + D) and the
 * usePlayerScreen hook extraction.
 *
 * Mounts the REAL LocketPlayerScreen on a REAL native stack (fakes only at the device boundary;
 * no mocking our own code), seeds recordings via the store's real writers, and asserts the real
 * affordances render. The transcript/summary cases drive the logic that moved into the hook
 * (recording lookup, transcriptComplete/hasPartial derivations, speakerRows, summary gating),
 * so this guard actually covers the extraction — green before and after = no behaviour change.
 */
// Un-mock react-navigation for THIS file: jest.setup stubs it globally (navigate no-op, useRoute {}),
// which breaks real route params. requireActual restores the real library so the seeded recordingId
// reaches the screen.
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));

import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { installPro } from '../harness/proHarness';

// Seed one recording (optionally enriched with transcript/summary via the real store writer),
// then mount the REAL player screen on a REAL native stack routed to it. Returns the RTL result.
async function renderSeededPlayer(enrich?: Record<string, unknown>) {
  const boundary = installNativeBoundary({ fs: true });
  const React = require('react');
  const { render, act } = requireRTL();
  await installPro();
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
  const { useRecordingsStore } = require('@offgrid/pro/locket/stores');

  useRecordingsStore.setState({ recordings: [], jobs: [] });

  const NOW = Date.now();
  boundary.fs!.seedFile('/docs/rec.wav', 5_000_000);
  useRecordingsStore.getState().addFinalized({
    path: '/docs/rec.wav', startedAt: NOW, endedAt: NOW,
    durationMs: 30 * 60 * 1000, sizeBytes: 5_000_000,
  });
  const id: string = useRecordingsStore.getState().recordings[0].id;
  if (enrich) useRecordingsStore.getState().updateRecording(id, enrich);

  const Stack = createNativeStackNavigator();
  const screens = getRegisteredScreens();
  const App = () =>
    React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator,
        { initialRouteName: 'LocketPlayer', screenOptions: { headerShown: false } },
        ...screens.map((sc: { name: string; component: React.ComponentType }) =>
          React.createElement(Stack.Screen, {
            key: sc.name,
            name: sc.name,
            component: sc.component,
            initialParams: sc.name === 'LocketPlayer' ? { sessionId: 'sess', recordingId: id } : undefined,
          })),
      ));
  const ui = render(React.createElement(App));
  // Let the screen mount + the player hook settle (the audio boundary is faked).
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  return ui;
}

describe('LocketPlayerScreen smoke (rendered): mounts a seeded recording', () => {
  it('renders the player for a seeded recording', async () => {
    const ui = await renderSeededPlayer();
    // The header overflow + info controls are present whenever the recording is found —
    // a stable anchor that does not depend on transient player-load state.
    expect(ui.getByTestId('recording-menu')).toBeTruthy();
    expect(ui.getByTestId('recording-info')).toBeTruthy();
  });

  it('shows the transcribe affordances for a completed, un-summarized transcript', async () => {
    // transcriptStatus 'done' => transcriptComplete true, hasPartial false: the finished-transcript
    // action row (Summarize / Add to chat) and the transcript re-run control render.
    const ui = await renderSeededPlayer({
      transcript: 'hello there. how are you.',
      transcriptStatus: 'done',
      transcriptSegments: [
        { text: 'hello there.', startMs: 0, endMs: 1500 },
        { text: 'how are you.', startMs: 1500, endMs: 3000 },
      ],
    });
    expect(ui.getByTestId('summarize-recording')).toBeTruthy();
    expect(ui.getByTestId('add-to-chat')).toBeTruthy();
    expect(ui.getByTestId('re-transcribe')).toBeTruthy();
  });

  it('shows the summary affordances once a transcript is summarized', async () => {
    // With a stored summary the Summary section renders (toggle + re-summarize) and the
    // Summarize CTA is replaced — the exact gating the extracted hook now derives.
    const ui = await renderSeededPlayer({
      transcript: 'hello there. how are you.',
      transcriptStatus: 'done',
      transcriptSegments: [
        { text: 'hello there.', startMs: 0, endMs: 1500 },
        { text: 'how are you.', startMs: 1500, endMs: 3000 },
      ],
      summary: '- greeting exchanged\n- wellbeing check',
      summaryStatus: 'done',
    });
    expect(ui.getByTestId('summary-toggle')).toBeTruthy();
    expect(ui.getByTestId('re-summarize')).toBeTruthy();
    expect(ui.getByTestId('re-transcribe')).toBeTruthy();
  });
});
