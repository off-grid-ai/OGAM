import { StyleSheet } from 'react-native';
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

/**
 * Hand test 55: an opening chat is hidden (opacity 0) until it rests at the newest message. Going from
 * opacity 0 to an undefined style kept the 0 on Fabric, so every chat stayed blank. Once settled, the
 * list must carry an explicit opacity 1.
 */
describe('an opening chat shows once it settles', () => {
  it('ends with the list at an explicit opacity 1, never left at 0 or undefined', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('[test] Count to five.', { text: '1 2 3 4 5' });
    const opacity = () => StyleSheet.flatten(h.view!.getByTestId('chat-message-list').props.style)?.opacity;

    // At most 800 ms after it opens, whatever the content does.
    await h.rtl.act(() => new Promise(resolve => setTimeout(resolve, 900)));
    expect(opacity()).toBe(1);
  });
});
