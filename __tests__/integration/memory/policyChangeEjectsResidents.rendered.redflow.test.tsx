/**
 * DEVICE 2026-07-14 — switching Model Loading to Lean (or any mode) with several models resident did
 * NOT eject them: TEXT + IMAGE + VOICE + SPEECH all stayed in RAM (screenshot). setLoadPolicy only
 * governs FUTURE loads, so the already-resident set was untouched until the next load. SPEC: changing
 * the loading mode ejects EVERY resident immediately (each selected model lazily reloads on next use
 * under the new mode) — the simple, predictable "you changed how models load, so we reset" behavior.
 *
 * Real ChatScreen load + real loadPolicySync + real activeModelService.ejectAll + real residency
 * manager; only the device leaves are faked. Residents are reached through REAL loads (text via the
 * Home picker, image via loadImageModel, whisper via a real download+select). The mode change arrives
 * through the SAME intent the Lean/Balanced/Aggressive control dispatches: updateSettings({ modelLoadingMode }).
 *
 * RED before the fix: after selecting Lean the residents are unchanged (still ≥2 in memory). GREEN:
 * the residency set is empty. Falsified: the seed itself must not eject (asserted below) — only a change does.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('policy change ejects every resident (device 2026-07-14) — Lean with models loaded frees them', () => {
  it('selecting Lean while text + image + whisper are resident ejects them all', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true });
    h.render();
    await h.placeImageModel({ backend: 'mnn' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');
    const { useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Start the projection (singleton; App starts it at boot). Its initial seed reads the current
    // mode (balanced) and MUST NOT eject — only a subsequent change does.
    startLoadPolicySync();
    await activeModelService.loadImageModel('sd');
    await h.setupWhisperModel();

    const residentCount = () => modelResidencyManager.getResidents().length;

    // Real precondition: more than one model is in memory (so "eject everything" is meaningful, and
    // the seed did NOT already eject them — the initial-seed guard holds).
    expect(residentCount()).toBeGreaterThanOrEqual(2);

    // GESTURE-INTENT: the exact dispatch the Lean segment fires (textGenAdvancedSections onSelect).
    await h.rtl.act(async () => {
      useAppStore.getState().updateSettings({ modelLoadingMode: 'lean' });
    });

    // SPEC: the mode change ejects every resident. RED before the fix: they stayed resident.
    await h.rtl.waitFor(() => { expect(residentCount()).toBe(0); }, { timeout: 4000 });
  });
});
