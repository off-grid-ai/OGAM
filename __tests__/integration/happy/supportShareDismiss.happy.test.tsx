/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — the rating ask dismisses after the user taps Rate
 * and does NOT re-nag on later generations.
 *
 * Row T096 (Area 14): "Trigger the rating ask → tap Rate → the sheet is dismissed (doesn't re-nag)".
 *
 * Heavy entry point: the REAL ChatScreen is mounted; the REAL generationService drives the REAL trigger
 * (checkSharePrompt increments the real textGenerationCount and emits the prompt on the 2nd text
 * generation, once per session). The REAL SharePromptSheet renders inside ChatScreen. We arrive at the
 * sheet by SENDING real messages (never store.setState / emitSharePrompt), tap Rate, and assert on the
 * rendered UI and the store-dialog leaf:
 *   1. after Rate, the sheet is gone and the store's own review dialog was requested, AND
 *   2. after more generations, the sheet does NOT re-appear.
 *
 * Device boundaries faked: the store review dialog (react-native-in-app-review) and Linking.openURL,
 * plus the engine leaf via chatHarness. The re-nag guard under test is the real persisted
 * `hasEngagedSharePrompt`: Rate sets it, and the real checkSharePrompt honors it.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

const SHEET_TITLE = 'Did that just work for you?';

const RATE_LABEL = 'Rate Off Grid AI';

describe('happy — support-share sheet dismisses after rating and does not re-nag (T096)', () => {
  it('llama.cpp: 2nd generation shows the sheet; rating dismisses it; the 10th does not re-nag', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'android' });
    h.render();

    // The store's review dialog and the store-page leaf. Same module graph as the freshly-required
    // SharePromptSheet (installNativeBoundary resets modules, so grab the post-reset instances).
    const { Linking } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const review = require('react-native-in-app-review').default.RequestInAppReview as jest.Mock;

    // PRE-CONDITION: after the 1st generation the sheet must NOT be up (count===1 is skipped to avoid
    // stacking sheets) — so a later "the sheet is present" assertion is a real observed transition, not a
    // surface that was always on screen. (count===1 never schedules an emit, so no delay needed here.)
    await h.send('first prompt', { text: 'reply one' });
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();

    // GESTURE → TRIGGER: the 2nd text generation. The REAL checkSharePrompt increments the count to 2,
    // shouldShowSharePrompt(2) is true, and (since not engaged) emits the prompt after the real delay.
    await h.send('second prompt', { text: 'reply two' });
    await h.rtl.waitFor(() => { expect(h.view!.getByText(SHEET_TITLE)).toBeTruthy(); }, { timeout: 15000 });
    expect(h.view!.getByText(RATE_LABEL)).toBeTruthy();

    // GESTURE: tap Rate — the sheet sets hasEngagedSharePrompt, closes, and once it has closed asks
    // the store for its own review dialog (the faked device leaf).
    h.rtl.fireEvent.press(h.view!.getByText(RATE_LABEL));

    // ASSERT (1): the sheet is dismissed after the share. Its title is gone from the rendered tree.
    //
    // 15s, not 4s: this passes locally every time and failed on a GitHub runner where this ONE test
    // took 9.6s. The assertion is unchanged - the wait just stops racing the hardware. It only surfaced
    // now because CI never reached jest before; the typecheck gate died first on an unbuilt package.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(SHEET_TITLE)).toBeNull(); }, { timeout: 15000 });
    // The store's own dialog was asked for, in the app. Nothing was sent out to a store page.
    await h.rtl.waitFor(() => { expect(review).toHaveBeenCalledTimes(1); });
    expect(openURL).not.toHaveBeenCalled();

    // "RETURN TO APP" + keep using it: drive generations up to the every-10th re-trigger count (10). If the
    // re-nag guard were broken, checkSharePrompt(10) would emit the prompt again and the sheet would reappear.
    for (let i = 3; i <= 10; i++) {
      await h.send(`prompt ${i}`, { text: `reply ${i}` });
    }
    await h.settle(1700); // past the delay again — give any (erroneous) re-emit time to render the sheet

    // ASSERT (2): the sheet does NOT re-appear (no re-nag) — because the user already engaged.
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();
  }, 60000);

  it("llama.cpp: Don't ask again dismisses the sheet and keeps it hidden in a new session", async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'android' });
    h.render();

    await h.send('first opt-out prompt', { text: 'reply one' });
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();

    await h.send('second opt-out prompt', { text: 'reply two' });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText("Don't ask again")).toBeTruthy();
    }, { timeout: 15000 });

    h.rtl.fireEvent.press(h.view!.getByText("Don't ask again"));
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();
    }, { timeout: 15000 });

    // A relaunch resets the in-memory session guard. The persisted user choice is the only reason
    // a later generation stays quiet, which is the exact behavior this action promises.
    const { resetSharePromptSession } = require('../../../src/utils/sharePrompt');
    resetSharePromptSession();
    await h.send('new session prompt', { text: 'reply three' });
    await h.settle(1700);
    expect(h.view!.queryByText(SHEET_TITLE)).toBeNull();
  }, 60000);
});
