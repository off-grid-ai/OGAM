/**
 * Ejecting the text model from the manager sheet while a reply is still streaming must STOP the
 * generation before the engine is torn down. Before: the eject went straight to the residency
 * manager's evict, so the native context was released under a running completion (a crash or a hang
 * on device). Now the shared ejection service owns the order for one resident too.
 *
 * Real ChatScreen, real stores, real residency and ejection services; only llama.rn is faked, with
 * its stream parked mid-reply.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('eject one resident mid-reply', () => {
  it('stops the running generation before the text engine is released', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    const llama = h.boundary.llama!;
    llama.scriptCompletion({ text: 'The answer is long and keeps going', pauseAfter: 'long' });
    await h.tapSend('tell me something');
    // The reply is on screen and parked mid-stream.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is long/)).not.toBeNull(); });

    const context = await llama.module.initLlama.mock.results[0]!.value;
    expect(context.stopCompletion).not.toHaveBeenCalled();
    expect(context.release).not.toHaveBeenCalled();

    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    const sheet = h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: true,
      onOpenRow: () => {}, onEject: () => {},
    }));
    await h.rtl.waitFor(() => { expect(sheet.queryByTestId('models-row-text-eject')).not.toBeNull(); }, { timeout: 4000 });
    h.rtl.fireEvent.press(sheet.getByTestId('models-row-text-eject'));

    await h.rtl.waitFor(() => { expect(context.release).toHaveBeenCalled(); }, { timeout: 4000 });
    // The stop landed, and it landed FIRST.
    expect(context.stopCompletion).toHaveBeenCalled();
    expect(context.stopCompletion.mock.invocationCallOrder[0]).toBeLessThan(
      context.release.mock.invocationCallOrder[0],
    );
  });
});
