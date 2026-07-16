/**
 * DEVICE 2026-07-14 — the ACTUAL reported case: a LiteRT model was STOPPED while still THINKING (reasoning
 * streaming, no content yet), and the whole message vanished. Root cause: reasoning streams to the store's
 * streamingReasoningContent, but the stop's keep-or-discard decision looked at streamingMessage ONLY — which
 * was empty during the thinking phase — so it cleared a reasoning-only partial the user could see.
 *
 * SPEC (the user's principle): once anything is shown — content OR reasoning — Stop keeps it, never discards.
 *
 * Journey: real ChatScreen + real generationService/stop; the LiteRT boundary emits a REASONING token then
 * holds (scriptThinkingThenHang) so a thinking block is genuinely on screen and in-flight → observe it + STOP
 * → press STOP → assert the thinking block SURVIVES (finalized as the interrupted reply's reasoning).
 *
 * RED on HEAD (pre-fix): stopGeneration checked streamingMessage only → cleared the reasoning-only partial →
 * the thinking block vanished. GREEN with the fix: keepShownPartialOrClear finalizes whenever a conversation
 * is streaming (finalize persists content OR reasoning), so the thinking stays.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('Stop during LiteRT thinking keeps the reasoning (device 2026-07-14)', () => {
  it('pressing STOP while only reasoning has streamed persists the thinking block — it does not disappear', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // The LiteRT native side emits a REASONING token then holds (no litert_complete) → thinking shown, in-flight.
    h.boundary.litert!.scriptThinkingThenHang('Let me work through what the capital of France is.');
    await h.send('what is the capital of France?', {} as never);

    // Anti-false-green: a thinking block is genuinely rendered AND the STOP control is present.
    await rtl.waitFor(() => { expect(view.queryAllByTestId('thinking-block').length).toBeGreaterThan(0); }, { timeout: 4000 });
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Real gesture: the user taps STOP mid-thinking.
    await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('stop-button')); });

    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(50);

    // THE FIX — the reasoning-only partial is kept (finalized), so the thinking block survives.
    // RED on HEAD: the message was cleared (streamingMessage was empty during thinking) → no thinking block.
    expect(view.queryAllByTestId('thinking-block').length).toBeGreaterThan(0);
  });
});
