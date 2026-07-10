/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — resend/regenerate: after a reply, the user long-presses
 * the assistant bubble and taps Retry; the REAL regenerate path produces a fresh answer that renders.
 *
 * Real ChatScreen + real gesture (long-press → action-retry) + real regenerateResponseFn + real engine;
 * only native leaves faked. Covers llama.cpp and LiteRT (regenerate is engine-agnostic; metal = llama-iOS,
 * proven by the first-message parity test).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — resend/regenerate (heavy entry point)', () => {
  it('llama.cpp: Retry produces a fresh answer', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('tell me a fact', { text: 'Honey never spoils.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull(); });

    await h.regenerateLast({ text: 'Octopuses have three hearts.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Octopuses have three hearts\./)).not.toBeNull(); });
  });

  it('LiteRT: Retry produces a fresh answer', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.render();
    await h.send('tell me a fact', { content: 'Honey never spoils.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull(); });

    await h.regenerateLast({ content: 'Octopuses have three hearts.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Octopuses have three hearts\./)).not.toBeNull(); });
  });
});
