/**
 * Deleting a chat while it is still drawing an image. The drawing stops, and nothing from it lands
 * in the Gallery or on disk afterwards, whether the chat is deleted from its own menu or from the
 * chats list. A result that still arrives for a chat that is gone is not saved either.
 *
 * Real ChatScreen (image drawn through the real image-mode toggle and send), real chat menu, real
 * ChatsListScreen and real GalleryScreen. Fakes only at the network (fetch, held open until the
 * test releases it) and the native file system.
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

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

describe('deleting a chat while its image is being drawn', () => {
  let server: ReturnType<typeof holdImageGeneration>;

  afterEach(() => {
    server.release();
    server.restore();
    clearRemoteServers();
  });

  /** Start drawing an image in a new chat and leave it in progress. */
  async function startDrawing(): Promise<Harness> {
    const h = await setupChatScreen({ engine: 'llama' });
    server = holdImageGeneration();
    h.boundary.fs!.serveRemoteFile(REMOTE_IMAGE_URL, {
      body: 'synthetic-png-bytes',
      headers: { 'Content-Type': 'image/png' },
    });
    await chooseRemoteImageModel(h);
    await h.tapSend('draw a lighthouse at dusk');
    expect(await h.view!.findByText('Generating Image')).toBeTruthy();
    expect(h.view!.queryByTestId('generated-image')).toBeNull();
    return h;
  }

  /** What the user finds afterwards: no image in the Gallery and no image file on disk. */
  async function expectNoImageLeft(h: Harness): Promise<void> {
    const React = require('react');
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    const gallery = h.rtl.render(React.createElement(GalleryScreen));
    expect(await gallery.findByText('No generated images yet')).toBeTruthy();
    expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(0);
    const fs = h.boundary.fs!;
    expect(fs.listFiles(`${fs.DocumentDirectoryPath}/generated_images`)).toHaveLength(0);
    gallery.unmount();
  }

  it('from its own menu: the drawing stops and no image is saved', async () => {
    const h = await startDrawing();

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByText(/Delete Chat|Delete Conversation/)));
    const confirm = await h.rtl.waitFor(() => h.view!.getByText(/^Delete$/));
    await h.rtl.act(async () => { h.rtl.fireEvent.press(confirm); });

    // The drawing ended with the chat, without waiting for the server to answer.
    await h.rtl.waitFor(() => { expect(mockGoBacks).toBe(1); });
    expect(server.aborted).toBe(1);
    expect(h.view!.queryByText('Generating Image')).toBeNull();
    h.view!.unmount();

    server.release();
    await expectNoImageLeft(h);
  });

  it('from the chats list: the drawing stops and no image is saved', async () => {
    const h = await startDrawing();
    h.view!.unmount();

    const React = require('react');
    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const chats = h.rtl.render(React.createElement(ChatsListScreen));
    h.rtl.fireEvent.press(await chats.findByLabelText(/^Delete /));
    await chats.findByText('Delete Chat');
    await h.rtl.act(async () => { h.rtl.fireEvent.press(chats.getByText(/^Delete$/)); });

    await h.rtl.waitFor(() => { expect(chats.queryAllByTestId(/^conversation-item-/)).toHaveLength(0); });
    expect(server.aborted).toBe(1);
    chats.unmount();

    server.release();
    await expectNoImageLeft(h);
  });

  it('a result that arrives after the chat is gone is not saved', async () => {
    const h = await startDrawing();
    const { useChatStore } = require('../../../src/stores');
    const conversationId = useChatStore.getState().activeConversationId;

    // The chat goes away without the chat screen's cleanup, and the server answers afterwards.
    await h.rtl.act(async () => { useChatStore.getState().deleteConversation(conversationId); });
    expect(server.aborted).toBe(0);
    await h.rtl.act(async () => { server.release(); });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Generating Image')).toBeNull(); });
    h.view!.unmount();

    await expectNoImageLeft(h);
  });
});
