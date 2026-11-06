/**
 * Deleting a chat whose image file cannot be removed must say so, and must keep that image in the
 * Gallery so the user can delete it again. Records go only after their file is gone.
 *
 * Real ChatsListScreen and GalleryScreen, real chat and app stores. The device filesystem and the
 * diffusion module are the in-memory native boundary; the filesystem refuses one unlink, as a
 * locked or permission-protected file does on device.
 */
import { deleteOpenImage, galleryWithRoutes } from '../../harness/galleryRoutes';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { setupChatScreen } from '../../harness/chatHarness';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

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
    const chats = rtl.render(withNavigator(React.createElement(ChatsListScreen)));
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
    const gallery = rtl.render(galleryWithRoutes());
    rtl.fireEvent.press(await gallery.findByTestId('gallery-image-img-locked'));
    expect(gallery.queryByTestId('gallery-image-img-free')).toBeNull();
    await deleteOpenImage(rtl, gallery);

    await rtl.waitFor(() => {
      expect(gallery.queryByTestId('gallery-image-img-locked')).toBeNull();
      expect(gallery.getByText('No generated images yet')).toBeTruthy();
    });
    expect(await fs.exists(lockedImage)).toBe(false);
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});

/**
 * The same delete from the other places a chat can be deleted: Home's recents and a project's chat
 * lists. Here the chat and its images are made the way the user makes them - a chat (in a project for
 * the project rows) where two images are drawn - so the images carry the chat they were drawn in.
 */
type DeleteSurface = 'Home recents' | 'project detail';

describe.each<DeleteSurface>(['Home recents', 'project detail'])('Deleting a chat from %s', surface => {
  it('removes its images from the Gallery and the disk, and reports an image that could not be removed', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    const { rtl } = h;

    if (surface !== 'Home recents') {
      // Make a project through its form, open it from the Projects tab, and start a chat in it.
      const form = await h.openScreen('ProjectEdit');
      rtl.fireEvent.changeText(form.getByTestId('project-edit-name'), 'Trip');
      rtl.fireEvent.changeText(
        form.getByPlaceholderText('How should chats here answer, and what should they know?'),
        'You help plan trips.',
      );
      rtl.fireEvent.press(form.getByTestId('project-edit-save'));
      const projects = await h.openTab('ProjectsTab');
      rtl.fireEvent.press(await rtl.waitFor(() => projects.getByText('Trip')));
      await rtl.waitFor(() => expect(h.currentRoute()).toBe('ProjectDetail'));
      rtl.fireEvent.press(await rtl.waitFor(() => projects.getByTestId('project-new-chat')));
      await rtl.waitFor(() => expect(h.currentRoute()).toBe('Chat'));
    }
    h.render();

    // Draw two images in the chat.
    await h.generateImageViaUI({ prompt: 'a lake at dawn' });
    await h.cycleImageMode(); // image mode is on for one message; turn it on again for the next
    await rtl.waitFor(() => expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull());
    await h.tapSend('a lake at dusk');
    await rtl.waitFor(() => expect(h.view!.queryAllByTestId('generated-image')).toHaveLength(2));
    const fs = h.boundary.fs!;
    const lockedImage = `${fs.DocumentDirectoryPath}/generated_images/img-1.png`;
    const freeImage = `${fs.DocumentDirectoryPath}/generated_images/img-2.png`;
    expect(await fs.exists(lockedImage)).toBe(true);
    expect(await fs.exists(freeImage)).toBe(true);

    // Before: the Gallery has both images.
    let gallery = await h.openScreen('Gallery');
    await rtl.waitFor(() => expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(2));
    expect(gallery.queryByTestId('gallery-image-img-1')).not.toBeNull();
    expect(gallery.queryByTestId('gallery-image-img-2')).not.toBeNull();

    // The device refuses to remove one file.
    const unlink = fs.module.unlink.getMockImplementation()!;
    fs.module.unlink.mockImplementation(async (path: string) => {
      if (path === lockedImage) throw new Error('EACCES: permission denied');
      return unlink(path);
    });

    // Delete the chat from the surface under test.
    const title = 'a lake at dawn';
    let screen: ReturnType<typeof rtl.render>;
    if (surface === 'Home recents') {
      screen = await h.openTab('HomeTab');
      expect(await screen.findByText(title)).toBeTruthy();
      rtl.fireEvent.press(screen.getByTestId('delete-conversation-button'));
    } else {
      screen = await h.openTab('ProjectsTab');
      rtl.fireEvent.press(await rtl.waitFor(() => screen.getByText('Trip')));
      await rtl.waitFor(() => expect(h.currentRoute()).toBe('ProjectDetail'));
      expect(await screen.findByText(title)).toBeTruthy();
      rtl.fireEvent.press(screen.getByLabelText(`Delete ${title}`));
    }
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Delete')); });

    // The chat is gone, and the user is told one image stayed and where to find it.
    expect(await screen.findByText('Some images were not deleted')).toBeTruthy();
    expect(screen.getByText(/1 image from the deleted chat could not be removed/)).toBeTruthy();
    expect(screen.queryByText(title)).toBeNull();
    rtl.fireEvent.press(screen.getByText('OK'));

    // The image that could be removed is off the disk and out of the Gallery; the one that stayed is listed.
    expect(await fs.exists(freeImage)).toBe(false);
    expect(await fs.exists(lockedImage)).toBe(true);
    gallery = await h.openScreen('Gallery');
    await rtl.waitFor(() => expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(1));
    expect(gallery.queryByTestId('gallery-image-img-1')).not.toBeNull();
    expect(gallery.queryByTestId('gallery-image-img-2')).toBeNull();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
