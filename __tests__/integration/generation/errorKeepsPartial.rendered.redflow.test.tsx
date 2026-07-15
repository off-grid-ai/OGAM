/**
 * DEVICE 2026-07-14 (principle) — "never discard shown output" extended from Stop to the ERROR path. If a
 * generation streams a partial and THEN errors mid-stream (e.g. a native decode failure, or a remote server
 * drop), the partial the user already saw must be kept — not wiped. The error handlers in
 * generationServiceHelpers used to clearStreamingMessage on error (llama/litert/remote alike); they now route
 * through keepShownPartialOnError → finalize (persists content OR reasoning, resets either way).
 *
 * Journey: real ChatScreen + real generation path; the llama boundary streams a partial then THROWS
 * (scriptCompletion throwAfter — device B13 shape: tokens flow, then llama_decode fails). Assert the streamed
 * text SURVIVES after the error settles.
 *
 * RED on HEAD (pre-fix): the error handler cleared the streaming message → the partial vanished. GREEN: kept.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const PARTIAL = 'Here is the answer so far before the runtime died';

describe('Error mid-generation keeps the shown partial (never discards output) — device 2026-07-14', () => {
  it('a mid-stream generation error persists the streamed partial instead of wiping it', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // Precondition (anti-false-green): the partial is NOT already on screen before we send.
    expect(view.queryByText(new RegExp(PARTIAL))).toBeNull();

    // The model streams the full partial, THEN the native runtime throws (device-shaped decode failure).
    // (throwAfter streams + throws synchronously, so the partial only lands via the error path's flush —
    // which is precisely the fix: keepShownPartialOnError forceFlushTokens + finalize, not clear.)
    await h.send('what is the answer?', { text: PARTIAL, throwAfter: 'llama_decode: failed to decode, ret = -1' } as never);

    // The turn ends (spinner/stop gone)…
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(80);

    // THE FIX — after the error, the model's produced output is kept as the (interrupted) reply.
    // RED on HEAD: the error handler cleared the streaming message → the partial is gone (null).
    await rtl.waitFor(() => { expect(view.queryByText(new RegExp(PARTIAL))).not.toBeNull(); }, { timeout: 4000 });
  });
});
