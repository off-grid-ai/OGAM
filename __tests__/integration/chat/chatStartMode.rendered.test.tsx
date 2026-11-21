/**
 * A chat opened to make pictures (the Images pick on Home, its guide page) is already in image mode:
 * the composer asks for a picture, the style strip shows, and the empty chat offers pictures to try.
 * It turns the mode on through the composer's own switch, so with no image model it says so, as the
 * switch does, and stays a plain chat.
 *
 * Real ChatScreen on the app's own navigation. Only the native engines and the disk are faked; the
 * image model is placed on disk (placeImageModel).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

describe('a chat opened to make pictures', () => {
  it('starts in image mode with the style strip and picture starters; a starter draws it', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    h.render();
    await h.placeImageModel();
    const view = h.view!;

    await h.openScreen('Chat', { mode: 'image' });

    await h.rtl.waitFor(() => expect(view.getByPlaceholderText('Describe a picture')).toBeTruthy());
    expect(view.getByTestId('style-row')).toBeTruthy();
    expect(view.getByTestId('empty-chat-image')).toBeTruthy();
    expect(view.getByText('What should it draw?')).toBeTruthy();

    h.rtl.fireEvent.press(view.getByRole('button', { name: 'A red fox in a snowy forest' }));

    await h.rtl.waitFor(() => expect(h.boundary.diffusion.calls.generateImage.length).toBe(1), { timeout: 8000 });
  });

  it('with no image model, says so as the switch does and stays a plain chat', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    h.render();
    const view = h.view!;

    await h.openScreen('Chat', { mode: 'image' });

    await h.rtl.waitFor(() => expect(view.getByText('No Image Model')).toBeTruthy());
    expect(view.queryByPlaceholderText('Describe a picture')).toBeNull();
    expect(view.queryByTestId('empty-chat-image')).toBeNull();
    expect(view.queryByTestId('style-row')).toBeNull();
  });
});
