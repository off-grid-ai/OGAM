/**
 * DEVICE 2026-07-14 (IMG_0162) — the user hit STOP and the reply was labeled
 * "Reply cut off at the token limit. Retry to continue." A stop is not a truncation.
 *
 * Root cause: the truncation flag was `stopped_eos === false || stopped_limit === 1 || truncated`.
 * A user stop lands as `interrupted:true, stopped_eos:false` — so `stopped_eos === false` tripped the
 * truncation label on every stopped turn. Fix: `isTruncatedResult` excludes `interrupted` and keys off
 * the n_predict-cap signal (stopped_limit / truncated) only — one shared verdict for both completion paths.
 *
 * Real mounted ChatScreen + real generationService/tool loop/llm service; fake ONLY the llama.rn boundary.
 * Generation details are ON (as on the device) so the per-message meta + the truncation warning render.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const CUTOFF = /Reply cut off at the token limit/i;

describe('stop is not labeled "cut off at the token limit" (rendered) — device IMG_0162', () => {
  it('a STOPPED turn shows NO truncation warning', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableGenerationDetailsViaUI(); // meta + truncation warning render (details were ON on device)
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // Send while the native completion holds in PREFILL (zero tokens) — a stop lands here as interrupted.
    await h.send('hi', { text: 'partial answer', holdBeforeStream: true } as never);
    // Anti-false-green: the STOP control genuinely rendered (the turn was really generating).
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Real gesture: STOP. The fake resolves the completion interrupted:true (device wire shape).
    await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('stop-button')); });
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(100);

    // RED on HEAD: the stopped turn is mislabeled "Reply cut off at the token limit."
    expect(view.queryByText(CUTOFF)).toBeNull();
  });

  it('falsify: a genuine n_predict cap-hit IS labeled "cut off at the token limit"', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableGenerationDetailsViaUI();
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // A turn that hits the cap without EOS (the real B15 truncation shape) — NOT interrupted.
    await h.send('write a long essay', {
      text: 'This reply runs right up to the cap',
      completionMeta: { stopped_eos: false, stopped_limit: 1, tokens_predicted: 2240 },
    });
    await rtl.waitFor(() => { expect(view.queryByText(/This reply runs right up to the cap/)).not.toBeNull(); }, { timeout: 4000 });

    // The truncation warning DOES render for a real cap-hit — the flag still works.
    await rtl.waitFor(() => { expect(view.queryByText(CUTOFF)).not.toBeNull(); }, { timeout: 4000 });
  });
});
