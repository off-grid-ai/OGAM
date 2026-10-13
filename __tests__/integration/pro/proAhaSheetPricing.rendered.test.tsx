/**
 * The Pro offer that appears in chat states the current price.
 *
 * SPEC (OGAM user's view): after a free user has had enough real conversations to know the
 * product (their 10th completed reply), chat offers Off Grid AI Pro once. That offer states the
 * current founder price - $119 once for life, or $7.99 a month - and never an older tier ($49,
 * $69) or a yearly plan ("/yr", "year"). Before the 10th reply, no offer and no price is on screen.
 *
 * Journey: the REAL ChatScreen and the REAL generation pipeline over the llama.rn native fake
 * (chatHarness). The user types and sends ten messages across two chats (five each, then a new
 * chat, as a user spreads work over conversations); each reply streams back from the native fake.
 * Nothing seeds the generation count: the ten real sends produce it.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const OFFER_HEADLINE = 'It already knows what you did today.';
// The chat offer appears a moment after the reply finishes; give it more than that moment.
const OFFER_SETTLE_MS = 2_000;
const STALE_PRICE_COPY = [/\$49/, /\$69/, /\/yr/i, /year/i];

describe('Pro offer in chat states the current price (rendered)', () => {
  it('after the 10th reply the offer shows $119 once for life or $7.99 a month, and no old or yearly price', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    const view = h.render();

    for (let turn = 1; turn <= 9; turn += 1) {
      if (turn === 6) {
        // The user reopens the first chat from the chat list, then starts a new chat.
        await h.openConversation(h.conversationId!);
        await h.openConversation();
        expect(view.queryByText('Answer number 5.')).toBeNull();
      }
      await h.send(`question number ${turn}`, { text: `Answer number ${turn}.` });
      await h.rtl.waitFor(() => expect(view.getByText(`Answer number ${turn}.`)).toBeTruthy());
    }

    // BEFORE: nine replies in, and past the moment an offer would appear, there is no offer and
    // no price on screen.
    await h.settle(OFFER_SETTLE_MS);
    expect(view.queryByText(OFFER_HEADLINE)).toBeNull();
    expect(view.queryByText(/\$119/)).toBeNull();
    expect(view.queryByText(/\$7\.99/)).toBeNull();

    await h.send('question number 10', { text: 'Answer number 10.' });
    await h.rtl.waitFor(() => expect(view.getByText('Answer number 10.')).toBeTruthy());

    await h.rtl.waitFor(() => expect(view.getByText(OFFER_HEADLINE)).toBeTruthy(), {
      timeout: OFFER_SETTLE_MS + 2_000,
    });
    expect(view.getByText(/\$119 once for life/)).toBeTruthy();
    expect(view.getByText(/\$7\.99 a month/)).toBeTruthy();
    for (const stale of STALE_PRICE_COPY) {
      expect(view.queryAllByText(stale)).toHaveLength(0);
    }
  }, 120_000);
});
