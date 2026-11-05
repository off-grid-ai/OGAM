/**
 * Opening the project sheet re-renders the chat screen. That render must not walk the open chat's
 * messages: a hand test on a phone with a long chat waited about 6 s for the sheet, because the
 * closed Debug sheet built a row for every message (and two counts scanned them all) on every render.
 *
 * Real ChatScreen, real navigation, real chat store. The long chat is placed in the store (a thousand
 * messages cannot be typed); its message list counts every read of a message, so the test sees any
 * per-message work the tap starts.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

const MESSAGE_COUNT = 1000;

function longChat(reads: { count: number }) {
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? ('assistant' as const) : ('user' as const),
    content: `Message ${i}`,
    timestamp: 1000 + i,
  }));
  const counted = new Proxy(messages, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.count += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return {
    id: 'long-chat',
    title: 'Long chat',
    modelId: 'm',
    messages: counted,
    createdAt: new Date(1000).toISOString(),
    updatedAt: new Date(2000).toISOString(),
  };
}

describe('project sheet in a long chat', () => {
  it('opens without reading any message of the chat', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    const reads = { count: 0 };
    h.useChatStore.setState({ conversations: [longChat(reads)] as never });
    // setupChatScreen resets the module registry: the route holder render() reads is the fresh one.
    require('../../harness/chatHarness').routeHolder.params = { conversationId: 'long-chat' };
    const view = h.render();
    const chip = await h.rtl.waitFor(() => view.getByLabelText('Project: Default. Change project'));
    await h.settle(100);

    expect(view.getAllByText('Long chat').length).toBeGreaterThan(0);
    reads.count = 0;
    h.rtl.fireEvent.press(chip);

    await h.rtl.waitFor(() => expect(view.getByText('Choose project')).toBeTruthy());
    expect(reads.count).toBe(0);
  });

  it('still lists every message when the Debug sheet is open', async () => {
    const { render } = require('@testing-library/react-native');
    const React = require('react');
    const { DebugSheet } = require('../../../src/components/DebugSheet');
    const reads = { count: 0 };
    const conversation = longChat(reads);
    const props = { onClose: () => {}, debugInfo: null, activeProject: null, settings: {}, activeConversation: conversation };

    const closed = render(React.createElement(DebugSheet, { ...props, visible: false }));
    expect(reads.count).toBe(0);
    closed.unmount();

    const open = render(React.createElement(DebugSheet, { ...props, visible: true }));
    expect(open.getByText(`Conversation Messages (${MESSAGE_COUNT})`)).toBeTruthy();
    expect(open.getByText(`#${MESSAGE_COUNT}`)).toBeTruthy();
  });
});
