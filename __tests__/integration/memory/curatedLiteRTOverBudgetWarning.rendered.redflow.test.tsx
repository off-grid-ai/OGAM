/**
 * RED-FLOW (UI integration, HEAVY entry point) — over-budget-but-WARNABLE curated LiteRT model.
 *
 * DEFECT (#510 7e652869): the onboarding ModelDownloadScreen pre-filters the curated LiteRT list to
 * ONLY files that fit the RAM budget, so a curated model that EXCEEDS the budget but carries a
 * "may exceed your device's memory / Download anyway" confirm (Gemma 4 E4B) is never rendered. Its
 * warning branch in handleLiteRTDownload is dead code: on a device where E4B is over budget the user
 * never sees the card, never sees the warning, and CANNOT start the download at all. Meanwhile the
 * download button is disabled={!isCompatible}, and isCompatible duplicated the budget math and was
 * false for the over-budget card — so even if it rendered, the warning was unreachable.
 *
 * SPEC (OGAM user's view): on a device where E4B exceeds the safe RAM budget but STILL has a warning,
 * the E4B card IS offered — its download button is enabled and tapping it shows the
 * "may exceed your device's memory" sheet with a "Download anyway" escape hatch (the guard). A curated
 * model that is over budget AND has NO warning (E2B on this same 4GB device) stays hidden, because
 * there is no safe way to offer it.
 *
 * Ground truth for the decision is the SINGLE owner curatedLiteRTDownloadWarning (over budget AND has
 * confirm copy) + fileExceedsBudget (the budget primitive). At 4GB (frac 0.50 → 2.0GB budget):
 *   E2B = 2.41GB  → over budget, NO warning  → HIDDEN
 *   E4B = 3.41GB  → over budget, HAS warning → OFFERED (warning-guarded)
 *
 * RED on HEAD: the pre-filter drops BOTH (both exceed 2.0GB), so the E4B card is ABSENT → warning
 * unreachable. GREEN after fix: E4B present + its download tap surfaces the warning; E2B stays hidden.
 *
 * Real ModelDownloadScreen + real hardwareService/memoryBudget/curated registry + real CustomAlert;
 * fakes ONLY at the native RAM-sensor boundary (installNativeBoundary). NEVER mocks our own code.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

// @react-navigation/native is OUTSIDE our system (an npm lib) — the only thing faked besides the device
// boundary. The screen only uses navigation.replace (Skip / connected), never during this flow.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('Curated LiteRT onboarding — an over-budget model that HAS a warning is offered (warning-guarded)', () => {
  it('offers the over-budget E4B card and surfaces its memory warning, while the over-budget no-warning E2B stays hidden (4GB Android)', async () => {
    // BOUNDARY: a 4GB Android device. frac(4GB)=0.50 → 2.0GB safe budget. Both curated LiteRT files
    // (E2B 2.41GB, E4B 3.41GB) exceed it; only E4B carries a confirmDownload warning.
    installNativeBoundary({ ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 3 * GB } });

    const React = require('react');
    const rtl = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { ModelDownloadScreen } = require('../../../src/screens/ModelDownloadScreen');

    // Prime the RAM cache the same way the screen's own effect does (getDeviceInfo → getTotalMemoryGB
    // reads cachedDeviceInfo). This is a device-boundary read, not our state.
    await hardwareService.getDeviceInfo();

    const nav: any = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {}, replace: () => {} };
    const view = rtl.render(React.createElement(ModelDownloadScreen, { navigation: nav }));

    // Wait for the async init effect to settle (loading → loaded).
    await rtl.waitFor(() => { expect(view.getByText('Set Up Your AI')).toBeTruthy(); }, { timeout: 10000 });

    // The over-budget-but-warnable E4B card IS offered. RED on HEAD: pre-filter dropped it → the
    // curated LiteRT list was empty (both files over budget). Assert on the LiteRT card specifically
    // (its testID + displayName) — the display name "Gemma 4 E2B/E4B" is also reused by a recommended
    // GGUF card, so match the LiteRT surface, not a bare display-name string.
    const e4bCard = await rtl.waitFor(() => view.getByTestId('litert-model-0'), { timeout: 10000 });
    expect(rtl.within(e4bCard).getByText('Gemma 4 E4B')).toBeTruthy();

    // The over-budget-with-NO-warning E2B (the OTHER curated LiteRT entry) stays hidden — no safe way
    // to offer it. So exactly ONE curated LiteRT card renders; there is no second one.
    expect(view.queryByTestId('litert-model-1')).toBeNull();

    // The warning is REACHABLE: the E4B download button is enabled and tapping it surfaces the sheet.
    // (On HEAD isCompatible was false → the button was disabled → even a rendered card couldn't warn.)
    const e4bDownload = await rtl.waitFor(() => view.getByTestId('litert-model-0-download'), { timeout: 10000 });
    await rtl.act(async () => { rtl.fireEvent.press(e4bDownload); });

    expect(await rtl.waitFor(() => view.getByText(/may exceed your device's memory/), { timeout: 10000 })).toBeTruthy();
    expect(view.getByText('Download anyway')).toBeTruthy();
  }, 60000);
});
