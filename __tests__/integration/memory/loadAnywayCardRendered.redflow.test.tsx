/**
 * RED-FLOW (UI, rendered) — a memory-refused text-model load MUST show the user a "Load Anyway"
 * override, never a dead-end "OK" alert. Asserted at the altitude that matters: what the USER SEES on
 * the mounted ChatScreen, arrived at by real gestures. Real everything; fakes only the RAM sensor +
 * native leaves.
 *
 * DEVICE GROUND TRUTH (2026-07-15, 12GB Android, Aggressive): loading a large text model ("qwythos")
 * refused with "Failed to load model: … it needs ~6738MB but only 5030MB is available" — an OK-only
 * alert, NO Load Anyway. Root cause: the pre-load context gate (llmSafetyChecks.resolveSafeContext)
 * threw a plain Error; loadModelWithOverride only offers "Load Anyway" for an OverridableMemoryError,
 * so a plain Error fell to the dead-end "Failed to load model" alert.
 *
 * The intersection reproduced (numbers pinned from the live [MEM-SM] trace, not guessed): Aggressive
 * mode → residency makeRoomFor ADMITS (sizeMB 5376 < budget 10813, fits=true); then resolveSafeContext
 * REFUSES because the model's weight estimate (6144MB, from the 5GB on-disk file) exceeds the raw
 * available snapshot (5120MB). That refusal — signature "it needs ~XMB but only YMB is available" — is
 * the device error and the fix site. So the test can ONLY pass when THAT gate refuses (it asserts the
 * signature), never false-greening on the residency gate.
 *
 * RED on HEAD (fix reverted): plain Error → the alert reads "Failed to load model", no "Load Anyway".
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('memory refusal shows "Load Anyway" on the rendered alert, not a dead-end (red-flow)', () => {
  it('tapping send when the pre-load context gate refuses surfaces a "Load Anyway" override the user can tap', async () => {
    // Pinned to iOS ON PURPOSE: the reclaim-aware gate fix (textPreloadGateReclaimAware) makes the
    // Android-aggressive cell ADMIT via the LMK reclaim credit, so the refusal this test needs only
    // survives on iOS (no reclaim credit — the gate reads raw). residency still admits (3.5GB record);
    // resolveSafeContext refuses on the raw 5GB on-disk weight estimate. deferInitialLoad → first send
    // triggers the real lazy load. This is why the two memory tests don't contradict each other.
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      modelFileSizeBytes: 3.5 * GB,
      ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 5 * GB },
      deferInitialLoad: true,
    });

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelLoadingModeSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // BOUNDARY: the ACTUAL on-disk model file is 5GB — resolveSafeContext sizes the model from the real
    // file (RNFS.stat), so its weight estimate (6144MB) exceeds the 5120MB raw-available snapshot and it
    // refuses. (The harness seeds a 500MB placeholder; a real 5GB download is the device reality.)
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(5 * GB));

    h.render();

    // Real app wiring: App.tsx boots this so the settings toggle drives the residency manager.
    const stopSync = startLoadPolicySync();
    // GESTURE: turn on Aggressive via the real segmented control (the device was in Aggressive).
    const toggle = h.rtl.render(React.createElement(ModelLoadingModeSelector, {}));
    h.rtl.fireEvent.press(toggle.getByTestId('model-loading-mode-aggressive-button'));
    await h.rtl.waitFor(() => { expect(require('../../../src/services/modelResidency').modelResidencyManager.getLoadPolicy()).toBe('aggressive'); });

    // Precondition: no refusal surface yet.
    expect(h.view!.queryByText('Load Anyway')).toBeNull();

    // GESTURE: the real first-send lazy load → residency admits → resolveSafeContext refuses.
    await h.tapSend('hello');

    // TERMINAL ARTIFACT: the override alert offers "Load Anyway", AND its body carries resolveSafeContext's
    // signature ("it needs ~") so this can only pass when THAT gate (the fix site) refuses — no false-green
    // on the residency gate. RED on HEAD: plain Error → dead-end "Failed to load model", no "Load Anyway".
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByText(/it needs ~/)).not.toBeNull();
    expect(h.view!.queryByText(/Failed to load model/)).toBeNull();

    stopSync();
  }, 30000);
});
