/**
 * RED-FLOW (UI, rendered) — a BACKGROUND STT model download must not render the mic as "loading".
 * Device ground truth (device-reported 2026-07-13, IMG_0143; re-raised 2026-07-14 — docs/GAPS_BACKLOG.md
 * "Mic button shows a loader for the WHOLE background STT download"): the user starts the voice-model
 * download (base.en, 142 MB) and the mic button sits in an indefinite busy state for the WHOLE download —
 * read as "the app is not ready to chat" — while chat is fully usable the entire time.
 *
 * SPEC (product view): a background download is NOT a busy state. While an STT model downloads and no
 * other STT model is usable, the mic shows the unavailable-mic glyph with a small, clearly-download
 * progress affordance (determinate — not a full-button loader), and the composer + send are visibly
 * unaffected. The busy spinner is reserved for a TAP-TRIGGERED model load and live transcription only.
 *
 * Real ChatScreen + real ChatInput/VoiceRecordButton + real whisperStore/whisperService + real
 * backgroundDownloadService; fakes only at the native leaves (DownloadManagerModule + whisper.rn + fs).
 * The download runs through the REAL download boundary with device-shaped progress events mid-flight.
 *
 * RED on HEAD: during the download the mic renders a bare ActivityIndicator busy circle (disabled) —
 * indistinguishable from a load in progress — and no download-progress affordance exists.
 * Falsifier inside: a genuine tap-triggered whisper load (held open at the initWhisper boundary) DOES
 * render the voice-loading spinner, which clears into the live recording UI on release.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

/** The catalogue size whisperService seeds for base.en (142 MB — the value the download alert shows). */
const BASE_EN_TOTAL_BYTES = 142 * 1024 * 1024;

const progressEvent = (downloadId: string, fraction: number) => ({
  downloadId,
  fileName: 'ggml-base.en.bin',
  modelId: 'whisper-base.en',
  bytesDownloaded: Math.round(BASE_EN_TOTAL_BYTES * fraction),
  totalBytes: BASE_EN_TOTAL_BYTES,
  status: 'running',
});

describe('mic during a background STT download — a download affordance, never a loader (IMG_0143)', () => {
  it('keeps chat usable and shows download progress on the mic — NOT the busy spinner', async () => {
    const h = await setupChatScreen({ engine: 'llama', whisper: true, download: true });
    h.render();
    const { ActivityIndicator } = require('react-native');

    // PRE-CONDITION (observed-transition guard): before any download the mic is the plain
    // unavailable glyph — no spinner, no download affordance — so the later assertions are
    // a real transition, not an always-true.
    const micBefore = await h.rtl.waitFor(() => h.view!.getByTestId('voice-record-button-unavailable'));
    expect(h.rtl.within(micBefore).UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(h.view!.queryByTestId('voice-mic-download-progress')).toBeNull();
    expect(h.view!.queryByTestId('voice-loading')).toBeNull();

    // GESTURE: tap the unavailable mic → the real "Download Voice Model" alert → tap Download.
    // This drives the REAL whisperStore.downloadModel → whisperService.downloadModel →
    // backgroundDownloadService.downloadFileTo → the native DownloadManagerModule fake.
    await h.rtl.act(async () => { h.rtl.fireEvent.press(micBefore); });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Download Voice Model')).not.toBeNull(); });
    await h.rtl.act(async () => { h.rtl.fireEvent.press(h.view!.getByText('Download')); });
    await h.rtl.waitFor(() => { expect(h.boundary.download!.active()).toHaveLength(1); }, { timeout: 4000 });
    const { downloadId } = h.boundary.download!.active()[0];
    await h.settle(100); // let downloadFileTo wire its per-id progress listeners

    // BOUNDARY: device-shaped progress lands mid-flight (30%). The download stays in flight —
    // no complete/error is ever emitted in this test.
    await h.rtl.act(async () => { h.boundary.download!.events.emit('DownloadProgress', progressEvent(downloadId, 0.3)); });

    // SPEC: the composer is visibly unaffected DURING the download — type + send works, the reply renders.
    await h.send('what is the capital of France', { text: 'Paris.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Paris\./)).not.toBeNull(); }, { timeout: 4000 });

    // More mid-flight progress (62%) — still downloading in the background.
    await h.rtl.act(async () => { h.boundary.download!.events.emit('DownloadProgress', progressEvent(downloadId, 0.62)); });

    // SPEC: the mic must NOT render a busy loader while a background download runs...
    const mic = await h.rtl.waitFor(() => h.view!.getByTestId('voice-record-button-unavailable'));
    expect(h.view!.queryByTestId('voice-loading')).toBeNull();
    // RED on HEAD: the whole-download busy circle (a bare ActivityIndicator inside the mic button —
    // IMG_0143's indefinite "loading" read) is exactly what renders here.
    expect(h.rtl.within(mic).UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    // ...and MUST render the determinate download affordance instead (RED on HEAD: it does not exist).
    const affordance = await h.rtl.waitFor(() => h.view!.getByTestId('voice-mic-download-progress'));
    expect(affordance.props.accessibilityLabel).toMatch(/download/i);
    expect(affordance.props.accessibilityLabel).toMatch(/62%/);
  }, 30000);

  it('falsifier: a genuine tap-triggered whisper load DOES show the voice-loading spinner', async () => {
    const h = await setupChatScreen({ engine: 'llama', whisper: true });
    await h.setupWhisperModel('tiny.en'); // downloaded + selected + resident, via the real select gesture
    h.render();
    const { useWhisperStore } = require('../../../src/stores/whisperStore');

    // BOUNDARY: the OS fires a memory warning → residency reclaims the idle STT sidecar. The model is
    // now downloaded-but-not-resident — the normal post-launch state a mic tap loads from.
    await h.rtl.act(async () => { h.boundary.emitMemoryWarning(); });
    await h.rtl.waitFor(() => { expect(useWhisperStore.getState().isModelLoaded).toBe(false); }, { timeout: 4000 });

    // PRE-CONDITION: idle mic — no spinner anywhere before the tap.
    expect(h.view!.queryByTestId('voice-loading')).toBeNull();

    // Hold the next whisper load open at the initWhisper boundary (a real ggml load takes seconds on
    // device), then do the REAL hold-to-talk gesture on the real mic.
    h.boundary.whisper!.holdNextLoad();
    await h.tapMic();

    // The TAP-TRIGGERED load shows the spinner — the state a background download must never mimic.
    await h.rtl.waitFor(() => { expect(h.view!.getByTestId('voice-loading')).toBeTruthy(); }, { timeout: 4000 });
    expect(h.view!.queryByTestId('voice-mic-download-progress')).toBeNull();

    // Release the load: the spinner clears into the LIVE recording UI (an observed transition, not a no-op).
    await h.rtl.act(async () => { h.boundary.whisper!.releaseLoad(); });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Slide to cancel')).not.toBeNull(); }, { timeout: 4000 });
    expect(h.view!.queryByTestId('voice-loading')).toBeNull();
  }, 30000);
});
