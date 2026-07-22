/**
 * P0 #87/#88 — the three-mode policy is visible through the real In Memory
 * surface. After selecting a mode through the shared control, the journey loads
 * the text model through chat and the image model through its real owning service,
 * then observes the resident rows.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type LoadingMode = 'conservative' | 'balanced';

describe('P0 model-loading modes on the In Memory surface', () => {
  it.each([
    { mode: 'conservative' as LoadingMode, keepsText: false },
    { mode: 'balanced' as LoadingMode, keepsText: true },
  ])(
    '$mode mode projects the expected heavy-model residency',
    async ({ mode, keepsText }) => {
      const h = await setupChatScreen({
        engine: 'litert',
        platform: 'android',
      });
      h.render();

      const React = require('react');
      const {
        ModelLoadingModeSelector,
      } = require('../../../src/components/settings/textGenAdvancedSections');
      const {
        startLoadPolicySync,
      } = require('../../../src/services/loadPolicySync');
      const {
        ModelsManagerSheet,
      } = require('../../../src/components/models/ModelsManagerSheet');
      const stopSync = startLoadPolicySync();

      const modeControl = h.rtl.render(
        React.createElement(ModelLoadingModeSelector),
      );
      h.rtl.fireEvent.press(
        modeControl.getByTestId(`model-loading-mode-${mode}-button`),
      );
      modeControl.unmount();

      // A policy change intentionally ejects existing residents. The next ordinary
      // text send lazy-loads the selected text model under the chosen policy.
      await h.send('say ready', { content: 'Ready.' });
      await h.rtl.waitFor(() =>
        expect(h.view!.getByText('Ready.')).toBeTruthy(),
      );

      await h.placeImageModel({ backend: 'mnn' });
      const {
        activeModelService,
      } = require('../../../src/services/activeModelService');
      await activeModelService.loadImageModel('sd');

      const inMemory = h.rtl.render(
        React.createElement(ModelsManagerSheet, {
          visible: true,
          onClose: () => {},
          labels: { text: '—', image: '—', voice: '—', speech: '—' },
          loadingState: { isLoading: false },
          isEjecting: false,
          hasActiveModel: true,
          onOpenRow: () => {},
          onEject: () => {},
        }),
      );
      await h.rtl.waitFor(() => {
        expect(inMemory.queryByTestId('models-row-image-ram')).not.toBeNull();
      });
      if (keepsText) {
        expect(inMemory.queryByTestId('models-row-text-ram')).not.toBeNull();
      } else {
        expect(inMemory.queryByTestId('models-row-text-ram')).toBeNull();
      }

      inMemory.unmount();
      h.view!.unmount();
      stopSync();
    },
  );
});
