/**
 * RED-FLOW (UI, rendered) — the TEXT pre-load memory gate must read the SAME reclaim-aware available RAM
 * as the residency gate, so the two can never disagree. On Android the low-memory killer hands background
 * apps' physical pages to the foreground app, so a clean mmap'd GGUF's true ceiling is the physical model
 * budget (modelMemoryBudgetMB), NOT the instantaneous raw snapshot. The single owner of that number is
 * memoryBudget.effectiveAvailableMB (its header: "so they can never disagree").
 *
 * DEVICE GROUND TRUTH (qwythos, 12GB Android, Aggressive): the residency gate ADMITTED the model
 * (reclaim-aware budget), then the SEPARATE text pre-load gate (llmSafetyChecks via llm.ts getMem) REFUSED
 * on the RAW snapshot — "it needs ~6738MB but only 5030MB available" — refusing a model the reclaim-aware
 * owner had just accepted. llm.ts's getMem fed checkMemoryForModel/resolveSafeContext the raw
 * hardwareService.getAppMemoryUsage() snapshot (total−used), never routed through effectiveAvailableMB.
 * Commit ea877f57 unified Android reclaim-awareness across the residency + override paths but never reached
 * this THIRD path.
 *
 * THE INTERSECTION (numbers pinned, not guessed — mirrors loadAnywayCardRendered.redflow's cell):
 *  - 12GB total / 5GB raw-available, ANDROID, Aggressive.
 *  - declared model size 3.5GB → residency makeRoomFor ADMITS (sizeMB 5376 < aggressive budget 10813). So
 *    residency does NOT refuse first — it cannot mask this gate (the loadAnywayCardRendered false-green trap).
 *  - the ACTUAL on-disk file is 5GB → the pre-load gate sizes weights from RNFS.stat at 6144MB (5GB×1.2).
 *  - RAW available (5120MB) < 6144MB+200 → the raw gate REFUSES.
 *  - reclaim-aware Android-aggressive available = max(5120, 10813) = 10813MB > 6144MB+200 → the gate ADMITS.
 *
 * So the ONLY difference the fix makes at this exact cell is: raw refuses (RED) vs reclaim-aware admits and
 * the model loads + generates (GREEN). That is the user-visible behavioral difference.
 *
 * RED on HEAD (getMem raw): the pre-load gate refuses → the model never loads → the send surfaces the
 * "it needs ~" refusal alert and no assistant reply renders. [MEM-SM] availMB=5120.
 * GREEN after fix (getMem reclaim-aware): the gate admits → the model loads → the scripted reply renders.
 * [MEM-SM] availMB=10813.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('text pre-load gate reads reclaim-aware available (rendered, red-flow)', () => {
  it('ANDROID Aggressive: residency admits and the reclaim-aware pre-load gate loads the model (raw gate would refuse)', async () => {
    // declared 3.5GB → residency (aggressive) admits (sizeMB 5376 < budget 10813). deferInitialLoad → the
    // first send triggers the real lazy load. android + 12GB total / 5GB raw-avail = the qwythos profile.
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
      modelFileSizeBytes: 3.5 * GB,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 5 * GB },
      deferInitialLoad: true,
    });

    const React = require('react');
    const { ModelLoadingModeSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');

    // BOUNDARY: the ACTUAL on-disk model file is 5GB — the pre-load gate sizes the model from the real file
    // (RNFS.stat), so its weight estimate (6144MB) exceeds the 5120MB RAW-available snapshot. The reclaim-
    // aware owner credits the physical budget (10813MB) instead. (The harness seeds a 500MB placeholder; a
    // real 5GB download is the device reality.)
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(5 * GB));

    h.render();

    // Real app wiring: App.tsx boots this so the settings toggle drives the residency manager.
    const stopSync = startLoadPolicySync();
    // GESTURE: turn on Aggressive via the real segmented control (the device was in Aggressive).
    const toggle = h.rtl.render(React.createElement(ModelLoadingModeSelector, {}));
    h.rtl.fireEvent.press(toggle.getByTestId('model-loading-mode-aggressive-button'));
    await h.rtl.waitFor(() => { expect(require('../../../src/services/modelResidency').modelResidencyManager.getLoadPolicy()).toBe('aggressive'); });
    toggle.unmount();

    // Precondition: no reply and no refusal surface yet.
    expect(h.view!.queryByText(/Paris\./)).toBeNull();
    expect(h.view!.queryByText(/it needs ~/)).toBeNull();

    // GESTURE: the real first-send lazy load → residency admits → the pre-load gate decides.
    await h.send('what is the capital of France', { text: 'Paris.' });

    // TERMINAL ARTIFACT — the user-visible difference the fix makes:
    //  GREEN (reclaim-aware): the gate admits, the model loads, the scripted reply renders.
    //  RED on HEAD (raw): the gate refuses, no reply, the "it needs ~" refusal alert shows instead.
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Paris\./)).not.toBeNull();
    }, { timeout: 8000 });
    // And the raw-snapshot refusal must NOT appear (it would on HEAD).
    expect(h.view!.queryByText(/it needs ~/)).toBeNull();

    stopSync();
  }, 30000);

  it('iOS UNCHANGED: the pre-load gate stays RAW (jetsam kills us, no reclaim credit) so the same model is refused', async () => {
    // Identical intersection on iOS. effectiveAvailableMB returns the RAW snapshot on iOS (no LMK reclaim —
    // jetsam kills US, not background apps), so the pre-load gate must STILL refuse the 5GB-on-disk model on
    // 5GB raw-available. This proves the fix did NOT alter iOS jetsam behavior: iOS availability is untouched.
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

    // BOUNDARY: the ACTUAL on-disk file is 5GB → the gate sizes weights at 6144MB > 5120MB raw available.
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(5 * GB));

    h.render();

    const stopSync = startLoadPolicySync();
    // GESTURE: Aggressive (matches the Android case) — but on iOS aggressive gives NO reclaim credit.
    const toggle = h.rtl.render(React.createElement(ModelLoadingModeSelector, {}));
    h.rtl.fireEvent.press(toggle.getByTestId('model-loading-mode-aggressive-button'));
    await h.rtl.waitFor(() => { expect(require('../../../src/services/modelResidency').modelResidencyManager.getLoadPolicy()).toBe('aggressive'); });
    toggle.unmount();

    expect(h.view!.queryByText(/it needs ~/)).toBeNull();

    // GESTURE: send → residency admits (iOS physical cap holds the 3.5GB spec) → the RAW pre-load gate refuses.
    await h.send('what is the capital of France', { text: 'Paris.' });

    // TERMINAL ARTIFACT: iOS still refuses on the raw snapshot — the "it needs ~" refusal renders and the reply
    // does NOT. iOS jetsam behavior is unchanged by the fix.
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/it needs ~/)).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByText(/Paris\./)).toBeNull();

    stopSync();
  }, 30000);
});
