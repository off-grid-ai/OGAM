/**
 * HAPPY-PATH (UI integration) — retrying an answer keeps the earlier one as a version.
 *
 * Real ChatScreen, real gestures (action menu → Retry, the ‹ › version arrows), real regenerate path,
 * real chat store and its thread rules (utils/chatThread over @offgrid/sync); only native leaves faked.
 * The person asks two questions, retries the FIRST answer, then steps back to it: the earlier answer
 * and the turn that followed it come back, and nothing was deleted.
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

describe('happy — retry keeps every answer as a version', () => {
  it('llama.cpp: an older answer retried shows 2/2, and Previous brings back its later turn', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('tell me a fact', { text: 'Honey never spoils.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull());
    await h.send('another one', { text: 'Bananas are berries.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Bananas are berries\./)).not.toBeNull());

    // Retry the first answer from its question: long-press the first question, then Retry.
    h.boundary.llama!.scriptCompletion({ text: 'Octopuses have three hearts.' });
    h.rtl.fireEvent(h.view!.getAllByTestId('user-message')[0]!, 'longPress');
    await h.rtl.waitFor(() => expect(h.view!.getByTestId('action-menu')).toBeTruthy());
    h.rtl.fireEvent.press(h.view!.getByTestId('action-retry'));
    await h.rtl.waitFor(() =>
      expect(h.view!.queryByText(/Octopuses have three hearts\./)).not.toBeNull(),
    );
    // The new answer is version 2 of 2; the later turn belongs to the first answer, so it is not shown.
    expect(h.view!.getByText('2/2')).toBeTruthy();
    expect(h.view!.queryByText(/Bananas are berries\./)).toBeNull();

    h.rtl.fireEvent.press(h.view!.getByLabelText('Previous response'));
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Honey never spoils\./)).not.toBeNull());
    expect(h.view!.getByText('1/2')).toBeTruthy();
    expect(h.view!.queryByText(/Bananas are berries\./)).not.toBeNull();
    expect(h.view!.queryByText(/Octopuses have three hearts\./)).toBeNull();

    // Every message is still saved.
    const { useChatStore } = require('../../../src/stores');
    const conversation = useChatStore.getState().conversations[0];
    expect(conversation.messages.map((message: { content: string }) => message.content)).toEqual(
      expect.arrayContaining([
        'tell me a fact',
        'Honey never spoils.',
        'another one',
        'Bananas are berries.',
        'Octopuses have three hearts.',
      ]),
    );
  });
});
