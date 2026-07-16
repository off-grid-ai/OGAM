/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — the "Support Open-Source AI" share sheet dismisses
 * after the user shares on X and does NOT re-nag on later generations.
 *
 * Row T096 (Area 14): "Trigger the support-share sheet → tap Share on X → return to app → the sheet is
 * dismissed (doesn't re-nag)". Device finding (docs/DEVICE_TEST_FINDINGS.md): "Support-sheet dismissal —
 * the 'support open source AI' share sheet dismisses correctly after returning from X (doesn't re-nag)."
 *
 * Heavy entry point: the REAL ChatScreen is mounted; the REAL generationService drives the REAL trigger
 * (checkSharePrompt increments the real textGenerationCount and, via shouldShowSharePrompt, emits the
 * prompt after 2 text generations, then again every 10th). The REAL SharePromptSheet renders inside
 * ChatScreen. We arrive at the sheet by SENDING real messages (never store.setState / emitSharePrompt),
 * tap the REAL "Share on X" button, and assert on the RENDERED UI:
 *   1. after the share, the sheet is gone, AND
 *   2. after driving generations up to the every-10th re-trigger count, the sheet does NOT re-appear.
 *
 * The ONLY device boundary faked is Linking.openURL (the leaf that hands the X compose intent to the OS —
 * "tap Share on X"), plus the engine leaf via chatHarness. The re-nag guard under test is the REAL
 * `hasEngagedSharePrompt` persistence: handleEngage sets it, and the real checkSharePrompt honors it.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const SHEET_TITLE = 'Support Open-Source AI';

describe('happy — support-share sheet dismisses after Share on X and does not re-nag (T096)', () => {
  it('llama.cpp: 2nd generation shows the sheet; sharing to X dismisses it; the 10th does not re-nag', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    // The X-share device leaf. Same module graph as the freshly-required SharePromptSheet (installNativeBoundary
    // resets modules, so we grab Linking from the post-reset react-native instance the component uses).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Linking } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

    // PRE-CONDITION: after the 1st generation the sheet must NOT be up (count===1 is skipped to avoid
    // stacking sheets) — so a later "the sheet is present" assertion is a real observed transition, not a
    // surface that was always on screen. (count===1 never schedules an emit, so no delay needed here.)
    await h.send('first prompt', { text: 'reply one' });
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();

    // GESTURE → TRIGGER: the 2nd text generation. The REAL checkSharePrompt increments the count to 2,
    // shouldShowSharePrompt(2) is true, and (since not engaged) emits the prompt after the real delay.
    await h.send('second prompt', { text: 'reply two' });
    await h.rtl.waitFor(() => { expect(h.view!.getByText(SHEET_TITLE)).toBeTruthy(); }, { timeout: 4000 });
    expect(h.view!.getByText('Share on X')).toBeTruthy();

    // GESTURE: tap "Share on X" — the REAL handleEngage sets hasEngagedSharePrompt, opens the X intent
    // (the faked device leaf), and closes the sheet.
    h.rtl.fireEvent.press(h.view!.getByText('Share on X'));

    // ASSERT (1): the sheet is dismissed after the share. Its title is gone from the rendered tree.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(SHEET_TITLE)).toBeNull(); }, { timeout: 4000 });
    // The X compose intent was actually handed to the OS (return-from-X boundary).
    await h.rtl.waitFor(() => { expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/x\.com\/intent\/post/)); });

    // "RETURN TO APP" + keep using it: drive generations up to the every-10th re-trigger count (10). If the
    // re-nag guard were broken, checkSharePrompt(10) would emit the prompt again and the sheet would reappear.
    for (let i = 3; i <= 10; i++) {
      await h.send(`prompt ${i}`, { text: `reply ${i}` });
    }
    await h.settle(1700); // past the delay again — give any (erroneous) re-emit time to render the sheet

    // ASSERT (2): the sheet does NOT re-appear (no re-nag) — because the user already engaged.
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();
  }, 60000);
});
