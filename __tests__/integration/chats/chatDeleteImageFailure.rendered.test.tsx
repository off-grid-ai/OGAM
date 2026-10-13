/**
 * Deleting a chat whose image file cannot be removed must say so, and must keep that image in the
 * Gallery so the user can delete it again. Records go only after their file is gone.
 *
 * Real ChatsListScreen and GalleryScreen, real chat and app stores. The device filesystem and the
 * diffusion module are the in-memory native boundary; the filesystem refuses one unlink, as a
 * locked or permission-protected file does on device.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type DeleteGesture = 'swipe delete' | 'select and delete';

describe.each<DeleteGesture>(['swipe delete', 'select and delete'])('Deleting a chat (%s) when an image file cannot be removed', gesture => {
  it('reports the image that stayed, keeps it in the Gallery, and the Gallery can delete it', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const fs = boundary.fs!;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const updatedAt = '2026-09-15T12:00:00.000Z';
    await AsyncStorage.setItem(
      'local-llm-chat-storage',
      JSON.stringify({
        state: {
          conversations: [{
            id: 'chat-trip',
            title: 'Trip photos',
            modelId: 'remote-model',
            messages: [{ id: 'm1', role: 'user', content: 'Trip photos', timestamp: Date.parse(updatedAt) }],
            createdAt: updatedAt,
            updatedAt,
          }],
          activeConversationId: null,
        },
        version: 2,
      }),
    );

    const React = require('react');
    const rtl = requireRTL();
    const { useChatStore } = require('../../../src/stores/chatStore');
    const { useAppStore } = require('../../../src/stores/appStore');
    await useChatStore.persist.rehydrate();

    const imagesDir = `${fs.DocumentDirectoryPath}/generated_images`;
    const saveImage = (id: string) => {
      const imagePath = `${imagesDir}/${id}.jpg`;
      fs.seedFile(imagePath, 2048);
      useAppStore.getState().addGeneratedImage({
        id, prompt: `a lake at dawn ${id}`, imagePath, width: 512, height: 512, steps: 1, seed: 1,
        modelId: 'remote-model', createdAt: updatedAt, conversationId: 'chat-trip',
      });
      return imagePath;
    };
    const lockedImage = saveImage('img-locked');
    const freeImage = saveImage('img-free');

    // The device refuses to remove one file.
    const unlink = fs.module.unlink.getMockImplementation()!;
    let locked = true;
    fs.module.unlink.mockImplementation(async (path: string) => {
      if (locked && path === lockedImage) throw new Error('EACCES: permission denied');
      return unlink(path);
    });

    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const chats = rtl.render(React.createElement(ChatsListScreen));
    expect(chats.getByText('Trip photos')).toBeTruthy();

    if (gesture === 'swipe delete') {
      rtl.fireEvent.press(chats.getByLabelText('Delete Trip photos'));
    } else {
      rtl.fireEvent.press(chats.getByLabelText('Select chats'));
      rtl.fireEvent.press(chats.getByText('Trip photos'));
      rtl.fireEvent.press(chats.getByLabelText('Delete selected chats'));
    }
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    await rtl.act(async () => { rtl.fireEvent.press(chats.getByText('Delete')); });

    // The chat is gone, but the user is told one image stayed and where to find it.
    expect(await chats.findByText('Some images were not deleted')).toBeTruthy();
    expect(chats.getByText(/1 image from the deleted chat could not be removed/)).toBeTruthy();
    expect(chats.queryByText('Trip photos')).toBeNull();
    expect(await fs.exists(freeImage)).toBe(false);
    expect(await fs.exists(lockedImage)).toBe(true);
    chats.unmount();

    // Retry from the Gallery: the image that stayed is listed, and deleting it now succeeds.
    locked = false;
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    const gallery = rtl.render(React.createElement(GalleryScreen));
    rtl.fireEvent.press(await gallery.findByTestId('gallery-image-img-locked'));
    expect(gallery.queryByTestId('gallery-image-img-free')).toBeNull();
    rtl.fireEvent.press(gallery.getByText('Delete'));
    await gallery.findByText('Delete Image');
    await rtl.act(async () => {
      rtl.fireEvent.press(gallery.getAllByText('Delete')[1]);
    });

    await rtl.waitFor(() => {
      expect(gallery.queryByTestId('gallery-image-img-locked')).toBeNull();
      expect(gallery.getByText('No generated images yet')).toBeTruthy();
    });
    expect(await fs.exists(lockedImage)).toBe(false);
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
