/**
 * T020 (HAPPY/GUARD, UI integration, HEAVY entry point) — selecting a LiteRT model marks it active WITHOUT
 * loading it into RAM; the first send then prepares it on demand.
 *
 * The T020 device note ("eager warm on select") is STALE: the app deliberately removed eager-load-on-select
 * (useModelLoading.ts:27-31 — "Selecting a model only MARKS it active … Loading eagerly here used to race
 * that path and leave both a text and an image model resident at the same time") in favour of the lazy load
 * the user asked for (DEVICE_TEST_FINDINGS: "Lazy model loading — model loads on first send, not on select
 * ('exactly the lazy model loading I wanted')"). This guard protects that decision from regressing back to
 * eager warm on selection (which re-introduces the co-residency race). Opening a chat is navigation,
 * not an inference request, so preparation must wait for the first send.
 *
 * Residency is validated through the model selector's real "In Memory" section (same as T111–T117), not
 * getResidents(). Falsify: if select eager-loaded, models-row-text-ram would be present BEFORE any send.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T020 (rendered) — LiteRT selection and chat entry stay lazy', () => {
  it('is NOT in memory after selection or chat entry, then IS in memory after first send', async () => {
    // deferInitialLoad: leave the model in the real select-but-not-loaded state (no forced pre-load).
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', deferInitialLoad: true });
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
     
    const openSelector = () => h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));

    // The LiteRT model was SELECTED via the real Home picker (setupChatScreen) but never sent to — so it is
    // NOT eager-warmed. The In Memory section shows no text model. (Poll a beat: the section polls residents.)
    const before = openSelector();
    await h.settle(400);
    expect(before.queryByTestId('models-row-text-ram')).toBeNull();
    before.unmount();

    // Opening the new chat is navigation only. It must not allocate the model.
    h.render();
    const afterEntry = openSelector();
    await h.settle(400);
    expect(afterEntry.queryByTestId('models-row-text-ram')).toBeNull();
    afterEntry.unmount();

    // The first send owns preparation and then serves the generation.
    await h.send('hello', { content: 'Hi there.' });
    const afterSend = openSelector();
    await h.rtl.waitFor(() => {
      expect(afterSend.queryByTestId('models-row-text-ram')).not.toBeNull();
    }, { timeout: 4000 });
    afterSend.unmount();
  });
});
