/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — reasoning/thinking: when the model emits reasoning
 * tokens before the answer, the user sees a "Thought process" block AND the final answer.
 *
 * Real ChatScreen + real generation pipeline + real ChatMessage/ThinkingBlock; only native LiteRT faked
 * (it emits reasoning on the litert_thinking channel, then the answer). Green complement to the Q6 thinking
 * red-flow.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — reasoning renders a thinking block + the answer (heavy entry point)', () => {
  it('shows the thinking block and the final answer when the model reasons first', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    h.render();

    await h.send('is 17 prime', { reasoning: 'Check divisors up to sqrt(17): 2,3 — none divide it.', content: 'Yes, 17 is prime.' });

    // The user sees the thinking affordance...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('thinking-block')).not.toBeNull(); });
    // ...and the final answer.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Yes, 17 is prime\./)).not.toBeNull(); });
  });
});
