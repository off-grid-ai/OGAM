/**
 * Per-model eject — the LAZY-LOAD half. After a user ejects a model from memory, the next time it is needed
 * it must lazy-reload on its own (ensureResident) and produce the result — ejecting frees RAM, it does not
 * disable the model.
 *
 * Real interactions: setupChatScreen loads a text model (Home picker). The user ejects it (the exact service
 * action the In Memory "Eject" triggers: modelResidencyManager.evictByKey). Then a real send must bring it
 * back and render the answer, and it is resident again.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('per-model eject — lazy reload on next use', () => {
  it('reloads an ejected text model when a message is sent, and answers', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const textResident = () => (modelResidencyManager.getResidents() as Array<{ type: string }>).some(r => r.type === 'text');

    // Text model is resident after load.
    expect(textResident()).toBe(true);

    // The user ejects it (what the In Memory "Eject" button calls) — freed from RAM.
    await modelResidencyManager.evictByKey('text');
    expect(textResident()).toBe(false);

    // When needed again, sending a message lazy-reloads it and the answer renders.
    await h.send('what is 2 plus 2', { content: 'It is 4.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/It is 4\./)).not.toBeNull(); }, { timeout: 6000 });

    // ...and it is resident again.
    expect(textResident()).toBe(true);
  });
});
