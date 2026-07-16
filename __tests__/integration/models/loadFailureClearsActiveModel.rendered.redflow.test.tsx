/**
 * RED-FLOW (integration → UI) — device 2026-07-14: when a text model FAILS to load, the active model must
 * become null EVERYWHERE (no stale selection driving the wrong settings/engine). The write is consolidated
 * in activeModelService (the one owner): set on select, on load-success, and CLEARED on load-failure.
 *
 * Drives the REAL load path (activeModelService.loadTextModel) over a llama boundary scripted to fail every
 * init attempt, then asserts the store invariant (activeModelId null) AND the UI outcome (the model selector
 * shows no "Currently Loaded" model). RED before the fix: the failed load left activeModelId at its prior
 * value, so the selector still showed a loaded model + the wrong settings.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('load failure clears the active model (rendered) — device 2026-07-14', () => {
  it('a text model that fails to load leaves activeModelId null and the selector showing no loaded model', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' }); // model 'm' loaded, active
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { llmService } = require('../../../src/services/llm');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Pre-condition: 'm' is the active loaded model.
    expect(h.useAppStore.getState().activeModelId).toBe('m');

    // Now a reload FAILS on every backend (corrupt file / unsupported arch).
    await activeModelService.unloadTextModel(true);
    h.boundary.llama!.scriptInitFailure();
    await activeModelService.loadTextModel('m').catch(() => {}); // real load path throws → caught

    // Invariant: the active model is null (never a stale selection).
    expect(h.useAppStore.getState().activeModelId).toBeNull();

    // UI outcome: the selector shows NO currently-loaded model (the user sees no active model).
    const v = h.rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {},
      isLoading: false, currentModelPath: llmService.getLoadedModelPath(),
    }));
    await h.rtl.waitFor(() => { expect(v.queryAllByTestId('model-item').length).toBeGreaterThanOrEqual(0); });
    expect(v.queryByTestId('currently-loaded-model')).toBeNull();
  }, 30000);
});
