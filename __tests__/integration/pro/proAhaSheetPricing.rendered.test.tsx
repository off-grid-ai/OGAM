/**
 * The Pro offer that appears in chat names the plans, not a price.
 *
 * SPEC (OGAM user's view): after a free user has had enough real conversations to know the
 * product (their 10th completed reply), chat offers Off Grid AI Pro once. That offer names the
 * two plans - once for life, or monthly - and no dollar price (the checkout sheet shows the live
 * one) and no yearly plan ("/yr", "year"). Before the 10th reply, no offer is on screen.
 *
 * Journey: the REAL ChatScreen and the REAL generation pipeline over the llama.rn native fake
 * (chatHarness). The user types and sends ten messages across two chats (five each, then a new
 * chat, as a user spreads work over conversations); each reply streams back from the native fake.
 * Nothing seeds the generation count: the ten real sends produce it.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

const OFFER_HEADLINE = 'It already knows what you did today.';
// The chat offer appears a moment after the reply finishes; give it more than that moment.
const OFFER_SETTLE_MS = 2_000;
const PRICE_OR_YEARLY = [/\$\s?\d/, /\/yr/i, /year/i];

describe('Pro offer in chat states the current price (rendered)', () => {
  it('after the 10th reply the offer names once for life or monthly, with no price or yearly plan', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
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
    // no plan copy on screen.
    await h.settle(OFFER_SETTLE_MS);
    expect(view.queryByText(OFFER_HEADLINE)).toBeNull();
    expect(view.queryByText(/once for life, or monthly/)).toBeNull();

    await h.send('question number 10', { text: 'Answer number 10.' });
    await h.rtl.waitFor(() => expect(view.getByText('Answer number 10.')).toBeTruthy());

    await h.rtl.waitFor(() => expect(view.getByText(OFFER_HEADLINE)).toBeTruthy(), {
      timeout: OFFER_SETTLE_MS + 2_000,
    });
    expect(view.getByText(/once for life, or monthly/)).toBeTruthy();
    for (const stale of PRICE_OR_YEARLY) {
      expect(view.queryAllByText(stale)).toHaveLength(0);
    }
  }, 120_000);
});
