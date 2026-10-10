/**
 * Remote image generation: the image is created on a remote server, then the phone transfers the
 * file from the URL the server returns.
 *
 * - Cancel during that transfer stops it and never saves the image, even when the transfer
 *   finishes as the cancel lands.
 * - A failed transfer leaves no file behind and offers Retry, which then draws the image.
 *
 * Real ChatScreen, real image-mode toggle, real remote model picker, real imageGenerationService
 * and remote image runner. Fakes only at the network (fetch) and native file system (RNFS) edges.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import type { RemoteTransfer } from '../../harness/nativeFileSystem';
import { REMOTE_IMAGE_URL, chooseRemoteImageModel, serveImageGeneration } from '../../harness/remoteImageServer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const IMAGE_URL = REMOTE_IMAGE_URL;
const PNG_BODY = 'synthetic-png-bytes';

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

describe('remote image transfer', () => {
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

  async function startHeldTransfer(honorsStop: boolean): Promise<RemoteTransfer> {
    const transfer = h.boundary.fs!.serveRemoteFile(IMAGE_URL, {
      body: PNG_BODY, headers: { 'Content-Type': 'image/png' }, hold: true, honorsStop,
    });
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(transfer.held()).toBe(true); });
    // BEFORE: the transfer is under way. Part of the file is on disk and no image is shown.
    expect(h.boundary.fs!.listFiles(imagesDir())).toHaveLength(1);
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    return transfer;
  }

  it('cancel during the transfer stops it and leaves no image and no file', async () => {
    await startHeldTransfer(true);

    await h.pressImageCardStop();
    await h.settle(200);

    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);
  });

  it('a transfer that finishes as cancel lands is not saved', async () => {
    const transfer = await startHeldTransfer(false);

    await h.pressImageCardStop();
    await h.rtl.act(async () => { transfer.release(); });
    await h.settle(200);

    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);
  });

  it('cancel while the image folder is being made never starts the transfer', async () => {
    // Review finding: an abort that landed before the transfer began was never heard.
    h.boundary.fs!.serveRemoteFile(IMAGE_URL, { body: PNG_BODY, headers: { 'Content-Type': 'image/png' } });
    const fs = h.boundary.fs!;
    const rnfs = fs.module;
    let folderMade: () => void = () => {};
    let making = false;
    const make = rnfs.mkdir.getMockImplementation()!;
    rnfs.mkdir.mockImplementation(async (path: string) => {
      if (path === imagesDir() && !making) {
        making = true;
        await new Promise<void>((resolve) => { folderMade = resolve; });
      }
      return make(path);
    });
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(making).toBe(true); });

    await h.pressImageCardStop();
    await h.rtl.act(async () => { folderMade(); });
    await h.settle(200);

    expect(rnfs.downloadFile).not.toHaveBeenCalled();
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(fs.listFiles(imagesDir())).toEqual([]);
  });

  it('a failed transfer leaves no file and Retry draws the image', async () => {
    h.boundary.fs!.serveRemoteFile(IMAGE_URL, { statusCode: 503, body: 'busy' });
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');

    const retry = await h.rtl.waitFor(() => h.view!.getByTestId('model-failure-retry-image'));
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toEqual([]);

    h.boundary.fs!.serveRemoteFile(IMAGE_URL, { body: PNG_BODY, headers: { 'Content-Type': 'image/png' } });
    await h.rtl.act(async () => { h.rtl.fireEvent.press(retry); });

    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); });
    expect(h.view!.queryByTestId('model-failure-image')).toBeNull();
    expect(h.boundary.fs!.listFiles(imagesDir())).toHaveLength(1);
    expect(server.requests).toBe(2);
  });
});
