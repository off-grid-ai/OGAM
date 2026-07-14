/**
 * T103 (checklist Area 15) / M6 (DEVICE_TEST_LOG) — RED-FLOW, UI-behavioral.
 *
 * The aggressive memory policy (0.88 Android / 0.92 iOS) over-commits a single DIRTY model. On a 12GB
 * Android device with only ~3GB truly free, sending an image request with a 9GB dirty (CoreML/ONNX) image
 * model gets it ADMITTED — the model becomes resident — because Android's reclaimable-aware budget credits
 * the physical ceiling to a dirty load whose GPU/anonymous pages zram cannot back. The correct behavior is
 * to REFUSE it (a graceful "Not Enough Memory" card, nothing resident), exactly as balanced/iOS already do.
 *
 * Device ground truth (M6, docs/DEVICE_TEST_LOG.md:43): "aggressive (0.88 Android / 0.92 iOS) admits a 9GB
 * dirty model on 12GB at 3GB free; zram/dirty pages can't back it." The gate-verdict twin is
 * overrideFloor.redflow M6 (service level). This test proves the SAME bug at the UI altitude the checklist
 * asks for: the whole real stack — the real ModelLoadingModeSelector gesture → real loadPolicySync → real
 * activeModelService/imageGenerationService → real modelResidencyManager — over the RAM-sensor + native
 * leaves only, validated on the model selector's "In Memory" section (a sanctioned residency UI surface).
 *
 * PLATFORM: this reproduces on ANDROID (where the over-commit is live). On iOS the same 9GB dirty load is
 * already REFUSED by the survival floor (iOS does not credit the physical budget to dirty pages — no swap),
 * so the bug is Android-specific despite M6 nominally naming both; the faithful red pins Android.
 *
 * NUMBERS (deterministic): image model on-disk size 3,865,470,566 B → hardwareService.estimateImageModelRam
 * applies the Android 2.5× working-set multiplier → the residency spec sees exactly 9216MB = 9GB dirty.
 * RAM: 12GB total / 3GB free. Policy: aggressive (via the real toggle). These recreate the exact M6 cell.
 *
 * RED (HEAD): the aggressive gate ADMITS the 9GB dirty image model → after send, the In Memory section lists
 * models-row-image-ram (~9.0 GB) and NO "Not Enough Memory" card renders. On HEAD the load is not even
 * refused first, so no "Load Anyway" prompt appears — aggressive silently over-commits (see the split note).
 * GREEN (after the fix): aggressive must refuse a dirty model that can't be physically backed → the image
 * model is NOT resident (models-row-image-ram absent) and the graceful memory card renders instead.
 *
 * THE SPLIT — what the fake proves vs what the human confirms:
 *  - The FAKE (this test) proves the JS ADMISSION decision: aggressive lets the 9GB dirty image model become
 *    resident on 12GB@3GB-free (the wrong verdict the user's device then pays for). That is pure JS math in
 *    modelResidencyManager/memoryBudget, decided before any native load.
 *  - The HUMAN confirms the NATIVE OOM: on the physical Android device the admitted dirty load takes a
 *    low-memory-killer SIGKILL (zram/dirty pages can't back 9GB), because the actual jetsam is uncatchable
 *    and not reproducible in Node. The [MEM-SM] makeRoomFor log is the on-device ground truth for that step.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

// On-disk bytes chosen so the Android 2.5× estimate lands the residency spec at EXACTLY 9216MB (9GB) dirty.
const NINE_GB_DIRTY_ON_DISK_BYTES = Math.round((9216 * 1024 * 1024) / 2.5); // 3,865,470,566

describe('T103 / M6 (rendered) — aggressive policy over-commits a 9GB dirty image model (In Memory UI)', () => {
  it('refuses the 9GB dirty image load on 12GB@3GB-free Android aggressive (RED: it is admitted/resident)', async () => {
    // Generous RAM so the text-model setup (select + lazy load) succeeds before we drop the device.
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelLoadingModeSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    const { hardwareService } = require('../../../src/services/hardware');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // BOUNDARY: a downloaded+extracted 9GB-dirty CoreML image model on disk. Core ML skips the mnn/qnn
    // integrity gate → straight to the memory gate. Its on-disk size drives the 2.5× estimate to 9GB dirty.
    await h.placeImageModel({ backend: 'coreml', size: NINE_GB_DIRTY_ON_DISK_BYTES });

    // GESTURE: turn image mode ON — this also activates the downloaded image model (the toggle sets
    // activeImageModelId when an image model is downloaded).
    await h.cycleImageMode();
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // Real app wiring: App.tsx boots this projection so the settings toggle drives the residency manager's
    // runtime policy. It is a service seam (the same one App starts), NOT a mock — without it the real toggle
    // would update the store but never reach the manager, which is not how the app runs.
    const stopSync = startLoadPolicySync();

    // GESTURE: turn Aggressive Loading ON via the real segmented control (the same control both settings
    // surfaces render). updateSettings → loadPolicySync → modelResidencyManager.setLoadPolicy('aggressive').
    const toggle = h.rtl.render(React.createElement(ModelLoadingModeSelector, {}));
    h.rtl.fireEvent.press(toggle.getByTestId('model-loading-mode-aggressive-button'));
    toggle.unmount();
    expect(require('../../../src/services/modelResidency').modelResidencyManager.getLoadPolicy()).toBe('aggressive');

    // PRECONDITION via the SAME real In Memory UI: no image model resident yet (so a later "present" is a
    // real transition, not a pre-existing artifact). The text model is resident from setup.
    const openSelector = () => h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));
    const before = openSelector();
    await h.rtl.waitFor(() => { expect(before.queryByTestId('models-row-text-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(before.queryByTestId('models-row-image-ram')).toBeNull();
    before.unmount();

    // Now the device is genuinely tight: 12GB total, only ~3GB truly free (other apps hold the rest). This is
    // the exact M6 cell. Aggressive's reclaimable-aware budget wrongly credits the physical ceiling to the
    // dirty load; the correct guard refuses (zram can't back 9GB of dirty/GPU pages on Android).
    h.boundary.setRam({ platform: 'android', totalBytes: 12 * GB, availBytes: 3 * GB });
    await hardwareService.refreshMemoryInfo();

    // GESTURE: send an image request. The real image-gen path hits the real residency gate at aggressive.
    await h.tapSend('a fox in the snow');
    await h.settle(400);

    // ASSERT on the terminal UI artifact. CORRECT (green after fix): the load is refused → nothing resident
    // for image, and the graceful "Not Enough Memory" card renders. BUG (red on HEAD): the 9GB dirty model is
    // admitted → the In Memory section lists models-row-image-ram (~9.0 GB) and no card appears.
    const after = openSelector();
    await h.settle(400); // let the section's poll pick up residency
    expect(after.queryByTestId('models-row-image-ram')).toBeNull();       // admitted on HEAD → RED here
    expect(h.view!.queryByText(/Not Enough Memory/)).not.toBeNull();      // no card on HEAD → RED here too
    after.unmount();

    // NO DEAD-END: a refusal must ALWAYS offer "Load Anyway" (we don't recommend it, but the user can
    // force it — evict everything and load). The card is not a terminal "not enough memory, stop".
    expect(h.view!.queryByTestId('model-failure-load-anyway-image')).not.toBeNull();

    // NO TERMINAL DEAD-END: the button's onLoadAnyway re-runs the load with { override: true }, which the
    // budget gate can no longer refuse (makeRoomFor under override always returns fits=true — no survival
    // floor). So the old "we evicted everything and there's STILL no memory" NON-overridable card is
    // unreachable. That override-always-loads invariant is proven at the service altitude in
    // overrideFloor.redflow (M3/M4/M6); whether the forced 9GB dirty load then survives is the native OOM
    // outcome (Provit, per the SPLIT note above) — not something the in-Node fake can honestly assert.

    stopSync();
  });
});
