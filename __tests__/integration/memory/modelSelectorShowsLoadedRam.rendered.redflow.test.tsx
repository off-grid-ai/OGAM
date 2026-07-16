/**
 * RESIDENCY VISIBILITY — the model selector must indicate WHAT is currently loaded AND how much memory it is
 * consuming (not a black box). Validated on the ACTUAL UI (the ModelSelectorModal "Currently Loaded" section),
 * with the loaded state arrived at through the real load path (setupChatScreen taps the Home picker → loads
 * the model), and the loaded path read from the real llmService (what the screen passes in).
 *
 * SPEC: Currently Loaded shows the model's name and its RAM footprint (~X GB RAM), so residency is visible.
 * Falsified: removing hardwareService.formatModelRam from the meta drops the "GB RAM" the test asserts → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('residency visibility — model selector shows the loaded model + its RAM', () => {
  it('renders the currently-loaded model name and its RAM consumption', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    const { llmService } = require('../../../src/services/llm');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The real UI, wired with the real loaded path the screen passes in.
    const v = h.rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {}, isLoading: false,
      currentModelPath: llmService.getLoadedModelPath(),
    }));

    // The selector indicates WHAT is loaded...
    expect(String(v.getByTestId('currently-loaded-model-name').props.children)).toContain('Test Model');
    // ...and HOW MUCH memory it consumes (RAM, not just disk size).
    expect(String(v.getByTestId('currently-loaded-model-ram').props.children)).toMatch(/GB RAM/);
  });
});
