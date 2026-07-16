/**
 * HAPPY-PATH (UI, BEHAVIORAL) — editing a message the way a user does: long-press the user bubble, tap
 * Edit, change the text, tap "SAVE & RESEND"; the edited message re-runs generation and the new answer
 * renders.
 *
 * Real ChatScreen + real action menu + real edit handler + real generation; only native LiteRT faked. Entry
 * is a genuine gesture chain (long-press → Edit → type → save), not a direct updateMessageContent call.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — edit a message via the real action menu (heavy entry point)', () => {
  // The action menu opens TWO ways — long-press the bubble AND the 3-dots '•••' button. Both are real
  // user entry points, so the edit flow is validated through each.
  it.each(['longpress', 'dots'] as const)('%s → Edit → change text → SAVE & RESEND re-runs generation', async (via) => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.render();

    await h.send('what is the capital of span', { content: 'The capital of Spain is Madrid.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The capital of Spain is Madrid\./)).not.toBeNull(); });

    // User fixes the typo and resends via the real Edit gesture (opened via this affordance).
    await h.editLastUserMessage('what is the capital of Spain', { content: 'Madrid is the capital of Spain.' }, via);
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Madrid is the capital of Spain\./)).not.toBeNull(); });
  });
});
