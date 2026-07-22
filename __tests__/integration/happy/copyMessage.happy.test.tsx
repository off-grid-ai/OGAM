/** P2 #45 — copying a rendered reply reaches the clipboard boundary. */
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

describe('P2 copy-message journey', () => {
  it('copies the visible assistant reply through its action menu', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    const { Clipboard } = require('react-native') as {
      Clipboard: { setString(value: string): void };
    };
    let clipboardText = '';
    Clipboard.setString = value => {
      clipboardText = value;
    };

    h.render();
    await h.send('Give me a short answer', {
      content: 'This reply should be copied exactly.',
    });
    await h.rtl.waitFor(() =>
      expect(
        h.view!.getByText('This reply should be copied exactly.'),
      ).toBeTruthy(),
    );

    await h.openActionMenu('assistant', 'dots');
    h.rtl.fireEvent.press(
      await h.rtl.waitFor(() => h.view!.getByTestId('action-copy')),
    );

    await h.rtl.waitFor(() => {
      expect(h.view!.getByText('Message copied to clipboard')).toBeTruthy();
      expect(clipboardText).toBe('This reply should be copied exactly.');
    });
    h.view!.unmount();
  });
});
