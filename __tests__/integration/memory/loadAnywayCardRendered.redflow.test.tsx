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
 * REFUSES. On an iPhone the weights are mapped, so the gate refuses a file past the fit rule for its
 * RAM: an 8GB file on a 12GB iPhone (past 0.62 of RAM). That refusal — signature "it needs ~XMB but only YMB is available" — is
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
    // resolveSafeContext refuses the 8GB on-disk file (past the iPhone fit rule). deferInitialLoad → first send
    // triggers the real lazy load. This is why the two memory tests don't contradict each other.
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      modelFileSizeBytes: 3.5 * GB,
      ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 5 * GB },
      deferInitialLoad: true,
    });

     
    const React = require('react');
    const { ModelLoadingModeSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');
     

    // BOUNDARY: the ACTUAL on-disk model file is 8GB — resolveSafeContext sizes the model from the real
    // file (RNFS.stat), and 8GB of mapped weights is past the fit rule for a 12GB iPhone, so it refuses.
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(8 * GB));

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
    h.boundary.llama!.scriptCompletion({ text: 'Paris.' });
    await h.tapSend('What is the capital of France?');

    // TERMINAL ARTIFACT: the override alert offers "Load Anyway", AND its body carries resolveSafeContext's
    // signature ("it needs ~") so this can only pass when THAT gate (the fix site) refuses — no false-green
    // on the residency gate. RED on HEAD: plain Error → dead-end "Failed to load model", no "Load Anyway".
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    }, { timeout: 20000 });
    expect(h.view!.queryByText(/it needs ~/)).not.toBeNull();
    expect(h.view!.queryByText(/Failed to load model/)).toBeNull();

    await h.rtl.act(async () => {
      let action: any = h.view!.getByText('Load Anyway');
      while (action && typeof action.props.onPress !== 'function') action = action.parent;
      expect(action).not.toBeNull();
      action.props.onPress();
    });
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Paris.')).not.toBeNull();
    }, { timeout: 8000 });
    // The explicit override must pass the selected 4K context to the native loader.
    // A successful reply at a silently reduced context is not a successful override.
    expect(h.boundary.llama!.module.initLlama.mock.calls.length).toBeGreaterThan(0);
    expect(h.boundary.llama!.module.initLlama.mock.calls.every(
      ([params]: [{ n_ctx: number }]) => params.n_ctx === 4096,
    )).toBe(true);
    expect(h.view!.getAllByTestId('user-message')).toHaveLength(1);

    stopSync();
  }, 45000);
});
