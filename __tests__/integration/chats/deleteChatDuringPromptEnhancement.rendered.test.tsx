/**
 * Deleting a chat while its image prompt is still being enhanced. The text model never answers, yet
 * the chat is deleted promptly: the enhancement request is stopped, the image is never requested,
 * and nothing lands in the Gallery or on disk.
 *
 * Real ChatScreen (image drawn through the real image-mode toggle and send), real chat menu and real
 * GalleryScreen. Fakes only at the device boundary: the llama.rn completion, held open before its
 * first token; the image server's fetch; and the native file system.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  REMOTE_IMAGE_URL,
  chooseRemoteImageModel,
  clearRemoteServers,
  holdImageGeneration,
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

describe('deleting a chat while its image prompt is being enhanced', () => {
  let server: ReturnType<typeof holdImageGeneration>;

  afterEach(() => {
    server.release();
    server.restore();
    clearRemoteServers();
  });

  it('stops the enhancement, deletes the chat promptly and saves no image', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    server = holdImageGeneration();
    h.boundary.fs!.serveRemoteFile(REMOTE_IMAGE_URL, {
      body: 'synthetic-png-bytes',
      headers: { 'Content-Type': 'image/png' },
    });
    await chooseRemoteImageModel(h);
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true });
    // The text model takes the enhancement request and never answers it.
    h.boundary.llama!.scriptCompletion({
      text: 'a lighthouse at dusk, warm light over a calm sea',
      holdBeforeStream: true,
    });
    await h.tapSend('draw a lighthouse at dusk');
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/Enhancing your prompt/i).length).toBeGreaterThan(0); });

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByText(/Delete Chat|Delete Conversation/)));
    const confirm = await h.rtl.waitFor(() => h.view!.getByText(/^Delete$/));
    await h.rtl.act(async () => { h.rtl.fireEvent.press(confirm); });

    // The chat is gone without the text model ever answering, because its request was stopped.
    await h.rtl.waitFor(() => { expect(mockGoBacks).toBe(1); });
    const context = await h.boundary.llama!.module.initLlama.mock.results.at(-1)!.value;
    expect(context.stopCompletion).toHaveBeenCalled();
    expect(server.requests).toBe(0);
    expect(h.view!.queryAllByText(/Enhancing your prompt/i)).toHaveLength(0);
    h.view!.unmount();

    const React = require('react');
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    const gallery = h.rtl.render(React.createElement(GalleryScreen));
    expect(await gallery.findByText('No generated images yet')).toBeTruthy();
    expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
    const fs = h.boundary.fs!;
    expect(fs.listFiles(`${fs.DocumentDirectoryPath}/generated_images`)).toHaveLength(0);
    gallery.unmount();
  });
});
