/**
 * DEVICE 2026-07-14 — the reported case was a LITERT model: Stop mid-generation discarded the partial and
 * the message disappeared. The llama sibling test (stopKeepsPartial) covers the same generationService stop
 * path, but the user's engine is LiteRT and the two engines have historically diverged — so this proves the
 * fix on the LiteRT path specifically.
 *
 * SPEC: once tokens are streamed and shown, Stop keeps them as the interrupted reply — never discards.
 *
 * Journey: real mounted ChatScreen + real generationService/stop + real liteRTService; the LiteRT native
 * boundary emits a PARTIAL token then holds (scriptPartialThenHang) so the partial is genuinely on screen
 * and in-flight → observe it + the STOP control → press STOP → assert the partial SURVIVES.
 *
 * RED on HEAD (pre-fix): stopGeneration read generationService.state (empty for LiteRT) → clearStreamingMessage
 * → the partial vanished. GREEN with the fix: keepShownPartialOrClear reads the store → it stays.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const PARTIAL = 'Looking at the image, I can see a';

describe('Stop mid-generation keeps the partial — LiteRT engine (device 2026-07-14)', () => {
  it('pressing STOP while a LiteRT partial is streaming persists it — the message does not disappear', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // The LiteRT native side emits a partial token then holds (no litert_complete) → partial shown, in-flight.
    h.boundary.litert!.scriptPartialThenHang(PARTIAL);
    await h.send('describe this', {} as never);

    // Anti-false-green: the partial really rendered AND the STOP control is present.
    await rtl.waitFor(() => { expect(view.queryByText(new RegExp(PARTIAL))).not.toBeNull(); }, { timeout: 4000 });
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Real gesture: the user taps STOP mid-stream.
    await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('stop-button')); });

    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(50);

    // THE FIX — the LiteRT partial the user saw survives, not discarded.
    expect(view.queryByText(new RegExp(PARTIAL))).not.toBeNull();
  });
});
