/**
 * Deleting the open chat from its own menu when one of its image files cannot be removed. The user
 * is told the image stayed, before the chat screen closes, and the image is still in the Gallery
 * where deleting it again works.
 *
 * Real ChatScreen (image drawn through the real image-mode toggle and send), real chat menu and
 * confirm alert, real GalleryScreen. Fakes only at the network (fetch) and the native file system,
 * which refuses one unlink as a locked or permission-protected file does on device.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  REMOTE_IMAGE_URL,
  chooseRemoteImageModel,
  clearRemoteServers,
  serveImageGeneration,
} from '../../harness/remoteImageServer';

let mockGoBacks = 0;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => { mockGoBacks += 1; },
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('deleting the open chat when an image file cannot be removed', () => {
  let server: ReturnType<typeof serveImageGeneration>;

  afterEach(() => {
    server.restore();
    clearRemoteServers();
  });

  it('says the image stayed before leaving, and the Gallery can delete it', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    server = serveImageGeneration();
    const fs = h.boundary.fs!;
    fs.serveRemoteFile(REMOTE_IMAGE_URL, { body: 'synthetic-png-bytes', headers: { 'Content-Type': 'image/png' } });

    // Draw an image in this chat through the real gestures.
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); });
    const imagesDir = `${fs.DocumentDirectoryPath}/generated_images`;
    const [imageFile] = fs.listFiles(imagesDir);
    expect(imageFile).toBeDefined();

    // The device refuses to remove that file.
    const unlink = fs.module.unlink.getMockImplementation()!;
    let locked = true;
    fs.module.unlink.mockImplementation(async (path: string) => {
      if (locked && path === imageFile) throw new Error('EACCES: permission denied');
      return unlink(path);
    });

    // Delete the chat from its own menu and confirm.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByText(/Delete Chat|Delete Conversation/)));
    const confirm = await h.rtl.waitFor(() => h.view!.getByText(/^Delete$/));
    await h.rtl.act(async () => { h.rtl.fireEvent.press(confirm); });

    // The user is told before the screen closes.
    expect(await h.view!.findByText('Some images were not deleted')).toBeTruthy();
    expect(h.view!.getByText(/1 image from the deleted chat could not be removed/)).toBeTruthy();
    expect(mockGoBacks).toBe(0);
    expect(await fs.exists(imageFile)).toBe(true);

    await h.rtl.act(async () => { h.rtl.fireEvent.press(h.view!.getByText('OK')); });
    expect(mockGoBacks).toBe(1);
    expect(h.view!.queryByText('Some images were not deleted')).toBeNull();
    h.view!.unmount();

    // Retry from the Gallery: the image that stayed is listed, and deleting it now succeeds.
    locked = false;
    const React = require('react');
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    const gallery = h.rtl.render(React.createElement(GalleryScreen));
    const tiles = await gallery.findAllByTestId(/^gallery-image-/);
    expect(tiles).toHaveLength(1);
    h.rtl.fireEvent.press(tiles[0]);
    h.rtl.fireEvent.press(gallery.getByText('Delete'));
    await gallery.findByText('Delete Image');
    await h.rtl.act(async () => { h.rtl.fireEvent.press(gallery.getAllByText('Delete')[1]); });

    await h.rtl.waitFor(() => {
      expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
      expect(gallery.getByText('No generated images yet')).toBeTruthy();
    });
    expect(await fs.exists(imageFile)).toBe(false);
  });
});
