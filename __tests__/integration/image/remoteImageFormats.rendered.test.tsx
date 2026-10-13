/**
 * Remote image generation, by what the server sends back for the image file.
 *
 * - An empty image body is a failure: the chat says so, no image is shown, nothing reaches the
 *   Gallery, and no file is left on the phone.
 * - A WebP image is saved and shown like any other, and the Gallery can delete it: it leaves the
 *   Gallery and its file is removed from the phone.
 *
 * Real ChatScreen, real image-mode toggle, real remote model picker, real imageGenerationService,
 * remote image runner and GalleryScreen. Fakes only at the network (fetch) and native file system
 * (RNFS) edges.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { REMOTE_IMAGE_URL, chooseRemoteImageModel, serveImageGeneration } from '../../harness/remoteImageServer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

describe('remote image formats', () => {
  let h: Harness;
  let server: ReturnType<typeof serveImageGeneration>;
  const imagesDir = () => `${h.boundary.fs!.DocumentDirectoryPath}/generated_images`;

  beforeEach(async () => {
    h = await setupChatScreen({ engine: 'llama' });
    server = serveImageGeneration();
  });

  afterEach(() => {
    server.restore();
    require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
  });

  function openGallery() {
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    return h.rtl.render(h.React.createElement(GalleryScreen));
  }

  it('an empty image from the server fails in the chat and leaves no image, no Gallery entry and no file', async () => {
    h.boundary.fs!.serveRemoteFile(REMOTE_IMAGE_URL, { body: '', headers: { 'Content-Type': 'image/png' } });
    await chooseRemoteImageModel(h);

    // BEFORE: no failure, no image.
    expect(h.view!.queryByTestId('model-failure-image')).toBeNull();
    expect(h.view!.queryByTestId('generated-image')).toBeNull();

    await h.tapSend('draw a lighthouse at dusk');

    const failure = await h.rtl.waitFor(() => h.view!.getByTestId('model-failure-image'));
    expect(h.rtl.within(failure).getByText(/empty image/i)).toBeTruthy();
    await h.settle(200);
    expect(server.requests).toBe(1);
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);

    const gallery = openGallery();
    expect(await gallery.findByText('No generated images yet')).toBeTruthy();
    expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
  });

  it('a WebP image from the server is shown, and deleting it from the Gallery removes it and its file', async () => {
    h.boundary.fs!.serveRemoteFile(REMOTE_IMAGE_URL, {
      body: 'RIFF\u0000\u0000\u0000\u0000WEBPVP8 synthetic-webp-bytes',
      headers: { 'Content-Type': 'image/webp' },
    });
    await chooseRemoteImageModel(h);
    expect(h.view!.queryByTestId('generated-image')).toBeNull();

    await h.tapSend('draw a lighthouse at dusk');

    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); });
    expect(h.view!.queryByTestId('model-failure-image')).toBeNull();
    const saved = h.boundary.fs!.listFiles(imagesDir());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/\.webp$/);
    h.view!.unmount();

    // BEFORE: the Gallery lists the image.
    const gallery = openGallery();
    const tiles = await h.rtl.waitFor(() => {
      const found = gallery.queryAllByTestId(/^gallery-image-/);
      expect(found).toHaveLength(1);
      return found;
    });
    expect(gallery.queryByText('No generated images yet')).toBeNull();

    h.rtl.fireEvent.press(tiles[0]);
    h.rtl.fireEvent.press(gallery.getByText('Delete'));
    await gallery.findByText('Delete Image');
    await h.rtl.act(async () => {
      h.rtl.fireEvent.press(gallery.getAllByText('Delete')[1]);
    });

    await h.rtl.waitFor(() => {
      expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
      expect(gallery.getByText('No generated images yet')).toBeTruthy();
    });
    expect(await h.boundary.fs!.exists(saved[0])).toBe(false);
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);
    await h.settle(250);
  });
});
