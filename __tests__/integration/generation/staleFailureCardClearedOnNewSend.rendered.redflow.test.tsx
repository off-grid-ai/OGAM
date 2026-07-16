/**
 * RED-FLOW (UI integration, HEAVY entry point) — a stale text-model failure card must be CLEARED when
 * the user starts a NEW generation attempt. Device ground truth (IMG 00:23, 2026-07-14; GAPS_BACKLOG
 * "Stale failure card not cleared when a NEW attempt starts"): a failed attempt painted the
 * "No response / incompatible backend" card (IMG_0145 — the K-quant-on-NPU/GPU zero-output failure,
 * reported via reportModelFailure('text', …) in useChatGenerationActions), and when the user sent the
 * next message the card STAYED — a dead card from attempt N sitting next to attempt N+1's live stream.
 *
 * SPEC (product view): starting a NEW attempt (send/retry) owns the failure surface — any text-model
 * failure card from the previous failed/stopped attempt is cleared at generation dispatch. A failure
 * card describes the LAST attempt; it must never render beside a newer live stream or a newer reply.
 *
 * Journey (real ChatScreen + real generationService/tool-free pipeline/stores; fake ONLY llama.rn):
 * send a turn whose native completion returns ZERO output (the device-shaped failure that paints this
 * card — a thrown completion takes the inline-assistant-error path instead, which is a different,
 * intentionally durable surface) → OBSERVE the failure card render (T056: the pre-condition is
 * asserted present, so the "cleared" assertion can never be a no-op) → send a NEW message whose
 * scripted completion streams and HOLDS mid-stream → assert the card is GONE while the new stream is
 * LIVE (the exact IMG 00:23 frame) → release → assert the reply renders and the card stays gone.
 *
 * RED on HEAD: clearModelFailure has ZERO callers — nothing ever clears the card, so it renders next
 * to the live stream. Falsifier inside: with NO new attempt, the observed card STAYS (the clear is
 * tied to dispatch, not to time or re-render — an over-broad "clear on render" fix fails it).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

/** Real Tools-screen gesture: the switch handler TOGGLES, so flipping the three default-ON tools
 *  turns them OFF — the turn then runs the tool-FREE pipeline (the plain chat turn of the device
 *  report; the tool loop renders an inline "_(No response)_" bubble instead of this card). */
function disableDefaultToolsViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  for (const id of ['web_search', 'read_url', 'search_knowledge_base']) h.enableToolViaUI(id);
}

describe('stale text failure card cleared on a NEW attempt (rendered) — device IMG 00:23', () => {
  it('clears the failure card at dispatch: the card from a failed turn never sits next to the next send\'s live stream', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    disableDefaultToolsViaUI(h);
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // Sanity: no failure card exists before anything failed.
    expect(view.queryByTestId('model-failure-text')).toBeNull();

    // ---- Turn 1: the attempt FAILS — the native completion emits ZERO output (device wire shape of
    // the incompatible-backend failure; IMG_0145). The real pipeline finalizes nothing, leaving the
    // user message last, and reportModelFailure('text', …) paints the "No response" card.
    await h.send('why is the sky blue?', { text: '' });

    // PRE-CONDITION OBSERVED (anti-false-green): the failure card genuinely rendered.
    await rtl.waitFor(() => { expect(view.queryByTestId('model-failure-text')).not.toBeNull(); }, { timeout: 6000 });
    expect(view.queryByText(/No response/)).not.toBeNull();

    // ---- Turn 2: the user starts a NEW attempt. The scripted completion streams and HOLDS
    // mid-stream so the live-stream state is a real, observable frame — not a race.
    try {
      await h.send('try again please', { text: 'Fresh reply after the failure.', pauseAfter: 'Fresh' } as never);

      // The new attempt is LIVE: stop control up, streamed tokens rendering.
      await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 6000 });
      await rtl.waitFor(() => { expect(view.queryByText(/Fresh/)).not.toBeNull(); }, { timeout: 6000 });

      // RED on HEAD — the IMG 00:23 frame: the stale card from the FAILED attempt renders next to
      // the live stream. SPEC: dispatching the new attempt cleared it.
      expect(view.queryByTestId('model-failure-text')).toBeNull();
      expect(view.queryByText(/No response/)).toBeNull();
    } finally {
      h.boundary.llama!.releaseStream(); // never leave the held native completion parked
    }

    // Terminal artifact: the new reply renders, and the stale card has not come back.
    await rtl.waitFor(() => { expect(view.queryByText(/Fresh reply after the failure\./)).not.toBeNull(); }, { timeout: 6000 });
    expect(view.queryByTestId('model-failure-text')).toBeNull();
  }, 30000);

  it('falsify: with NO new attempt the observed card STAYS — the clear is tied to dispatch, not re-render/time', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    disableDefaultToolsViaUI(h);
    h.render();
    const { rtl } = h;
    const view = h.view!;

    await h.send('why is the sky blue?', { text: '' });
    await rtl.waitFor(() => { expect(view.queryByTestId('model-failure-text')).not.toBeNull(); }, { timeout: 6000 });

    // No new attempt is started. The failure surface must persist (it is dismissible, not ephemeral).
    await h.settle(400);
    expect(view.queryByTestId('model-failure-text')).not.toBeNull();
    expect(view.queryByText(/No response/)).not.toBeNull();
  }, 30000);
});
