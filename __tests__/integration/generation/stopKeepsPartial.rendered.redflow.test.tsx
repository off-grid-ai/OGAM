/**
 * DEVICE 2026-07-14 — pressing Stop mid-generation DISCARDED the partial that was already on screen: the
 * message disappeared. The keep-or-discard decision read generationService's internal state
 * (state.streamingContent / isGenerating), which can be empty/false (LiteRT, or after generationSession.end
 * reset the state before stopGeneration ran) even while the store's streamingMessage — what the user sees —
 * was full. So shown output got thrown away.
 *
 * SPEC (the user's principle): once tokens are streamed and shown, they are NEVER discarded. Stopping keeps
 * the partial as the (interrupted) assistant reply. The decision must read the store's streamingMessage.
 *
 * Journey: real mounted ChatScreen + real generationService/stop path; fake ONLY the llama.rn boundary. The
 * completion streams a partial then PAUSES (pauseAfter) so the partial truly renders → observe it on screen
 * (anti-false-green) → press STOP → assert the partial SURVIVES as a persisted message. The fix is
 * engine-agnostic (it lives in generationService.stopGeneration, which reads the store); llama is used
 * because the boundary fake scripts streaming there.
 *
 * RED on HEAD (pre-fix): after STOP the partial vanishes (clearStreamingMessage). GREEN with the fix: it stays.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const PARTIAL = 'The capital of France is Paris and it';

describe('Stop mid-generation keeps the shown partial (never discards output) — device 2026-07-14', () => {
  it('pressing STOP while a partial is streaming persists it — the message does not disappear', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // Stream a partial, then PAUSE mid-completion so the partial is genuinely on screen (not a flash).
    await h.send('what is the capital of France?', { text: `${PARTIAL} sits on the Seine.`, pauseAfter: PARTIAL } as never);

    // Anti-false-green: the partial really rendered AND the generating STOP control is present.
    await rtl.waitFor(() => { expect(view.queryByText(new RegExp(PARTIAL))).not.toBeNull(); }, { timeout: 4000 });
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Real gesture: the user taps STOP mid-stream.
    await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('stop-button')); });

    // The turn ends (input back to idle)…
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(50);

    // THE FIX — the partial the user saw is STILL there (persisted as the interrupted reply), not discarded.
    // RED on HEAD: stopGeneration called clearStreamingMessage → this partial vanished.
    expect(view.queryByText(new RegExp(PARTIAL))).not.toBeNull();
  });
});
