/**
 * The chats list's search field stays put above the chats, and typing in it filters without losing it.
 *
 * SPEC (the user's view): on the Chats tab the search field is a bar fixed above the list, with a
 * shadow along its bottom edge that the chats scroll under. When I type a word one letter at a time,
 * the list narrows to the matching chats and the field stays the same field (it is not rebuilt,
 * which would drop the keyboard).
 *
 * The real ChatScreen makes the chats (type, press send, the llama native leaf answers); the real
 * ChatsListScreen shows them. Only native leaves are faked.
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

type Node = { parent?: Node | null; props?: Record<string, unknown> };
const isInside = (node: Node, ancestor: Node) => {
  for (let at: Node | null | undefined = node; at; at = at.parent) if (at === ancestor) return true;
  return false;
};

describe('chats list search field', () => {
  it('stays put above the chats and filters as I type without being rebuilt', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    const prompts = ['first trip plan', 'second grocery list', 'third reading notes'];
    for (const [index, prompt] of prompts.entries()) {
      if (index > 0) await h.newChatViaHome();
      await h.send(prompt, { text: `Answer ${index + 1}.` });
      await h.rtl.waitFor(() => expect(h.view!.queryByText(`Answer ${index + 1}.`)).not.toBeNull());
    }
    h.view!.unmount();

    const React = require('react');
    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const list = h.rtl.render(React.createElement(ChatsListScreen));
    for (const prompt of prompts) expect(list.getByText(prompt)).toBeTruthy();

    // The field is a bar fixed above the list, not part of what scrolls.
    const field = list.getByTestId('chat-search-input') as Node;
    expect(isInside(field, list.getByTestId('conversation-list') as Node)).toBe(false);

    // Type "grocery" one letter at a time: the same field takes every letter.
    let typed = '';
    for (const letter of 'grocery') {
      typed += letter;
      h.rtl.fireEvent.changeText(list.getByTestId('chat-search-input'), typed);
      expect(list.getByTestId('chat-search-input')).toBe(field);
    }
    expect(field.props?.value).toBe('grocery');

    // The list narrowed to the one matching chat.
    expect(list.getByText('second grocery list')).toBeTruthy();
    expect(list.queryByText('first trip plan')).toBeNull();
    expect(list.queryByText('third reading notes')).toBeNull();

    // Clearing brings every chat back.
    h.rtl.fireEvent.press(list.getByLabelText('Clear chat search'));
    for (const prompt of prompts) expect(list.getByText(prompt)).toBeTruthy();
    list.unmount();
  });
});
