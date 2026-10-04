/**
 * RED-FLOW (UI, rendered) — a memory-refused text-model load MUST show the user a "Load Anyway"
 * override, never a dead-end "OK" alert. Asserted at the altitude that matters: what the USER SEES on
 * the mounted ChatScreen, arrived at by real gestures. Real everything; fakes only the RAM sensor +
 * native leaves.
 *
 * Shared residency is the canonical admission owner. This test uses a model that
 * cannot fit its aggressive budget and proves the typed refusal reaches the real
 * rendered override surface.
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
    // The first send triggers the real lazy load. A 9GB model cannot fit the
    // aggressive budget on this 12GB iOS device.
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      modelFileSizeBytes: 9 * GB,
      ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 5 * GB },
      deferInitialLoad: true,
    });

     
    const React = require('react');
    const { ModelLoadingModeSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { startLoadPolicySync } = require('../../../src/services/loadPolicySync');
     

    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(9 * GB));

    h.render();

    // Real app wiring: App.tsx boots this so the settings toggle drives the residency manager.
    const stopSync = startLoadPolicySync();
    // GESTURE: turn on Aggressive via the real segmented control (the device was in Aggressive).
    const toggle = h.rtl.render(React.createElement(ModelLoadingModeSelector, {}));
    h.rtl.fireEvent.press(toggle.getByTestId('model-loading-mode-aggressive-button'));
    await h.rtl.waitFor(() => { expect(require('../../harness/activeModelLifecycle').modelResidencyManager.getLoadPolicy()).toBe('aggressive'); });

    // Precondition: no refusal surface yet.
    expect(h.view!.queryByText('Run anyway')).toBeNull();

    // GESTURE: the real first-send lazy load → shared residency refuses.
    await h.tapSend('hello');

    // TERMINAL ARTIFACT: the typed memory refusal offers the override instead of
    // degrading into a generic failed-load alert.
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Run anyway')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByText(/Not Enough Memory/)).not.toBeNull();
    expect(h.view!.queryByText(/Failed to load model/)).toBeNull();

    // This settings root owns an asynchronous hardware refresh. Unmount it before
    // Jest tears down the native-boundary module graph.
    toggle.unmount();
    stopSync();
  }, 30000);
});
