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
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (screen: string, params?: Record<string, unknown>) =>
      require('../../harness/chatHarness').recordNavigation(screen, params),
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  // The route the screen was opened with (chatHarness.routeHolder; empty unless a step navigated).
  useRoute: () => require('../../harness/chatHarness').routeHolder,
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

/**
 * The same delete from the other places a chat can be deleted: Home's recents and a project's chat
 * lists. Here the chat and its images are made the way the user makes them - a chat (in a project for
 * the project rows) where two images are drawn - so the images carry the chat they were drawn in.
 */
type DeleteSurface = 'Home recents' | 'project detail' | 'project chats';

describe.each<DeleteSurface>(['Home recents', 'project detail', 'project chats'])('Deleting a chat from %s', surface => {
  it('removes its images from the Gallery and the disk, and reports an image that could not be removed', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    const { rtl, React } = h;
    const harness = require('../../harness/chatHarness');
    const navigatedTo = () => harness.navHolder.last as { screen: string; params?: Record<string, unknown> };
    const homeNavigation = { navigate: harness.recordNavigation, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };

    let projectId: string | undefined;
    if (surface !== 'Home recents') {
      // Make a project through its form, open it from the Projects list, and start a chat in it.
      const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
      harness.routeHolder.params = {};
      const form = rtl.render(React.createElement(ProjectEditScreen, {}));
      rtl.fireEvent.changeText(form.getByTestId('project-edit-name'), 'Trip');
      rtl.fireEvent.changeText(
        form.getByPlaceholderText('Enter the instructions or context for the AI...'),
        'You help plan trips.',
      );
      rtl.fireEvent.press(form.getByTestId('project-edit-save'));
      form.unmount();
      const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
      const projects = rtl.render(React.createElement(ProjectsScreen, {}));
      rtl.fireEvent.press(await rtl.waitFor(() => projects.getByText('Trip')));
      projects.unmount();
      expect(navigatedTo().screen).toBe('ProjectDetail');
      projectId = navigatedTo().params!.projectId as string;
      harness.routeHolder.params = { projectId };
      const { ProjectDetailScreen } = require('../../../src/screens/ProjectDetailScreen');
      const detail = rtl.render(React.createElement(ProjectDetailScreen, {}));
      rtl.fireEvent.press(await rtl.waitFor(() => detail.getByTestId('project-start-chat')));
      detail.unmount();
      expect(navigatedTo().screen).toBe('Chat');
      harness.routeHolder.params = navigatedTo().params!;
    }

    // Draw two images in the chat.
    await h.generateImageViaUI({ prompt: 'a lake at dawn' });
    await h.cycleImageMode(); // image mode is on for one message; turn it on again for the next
    await rtl.waitFor(() => expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull());
    await h.tapSend('a lake at dusk');
    await rtl.waitFor(() => expect(h.view!.queryAllByTestId('generated-image')).toHaveLength(2));
    h.view!.unmount();
    const fs = h.boundary.fs!;
    const lockedImage = `${fs.DocumentDirectoryPath}/generated_images/img-1.png`;
    const freeImage = `${fs.DocumentDirectoryPath}/generated_images/img-2.png`;
    expect(await fs.exists(lockedImage)).toBe(true);
    expect(await fs.exists(freeImage)).toBe(true);

    // Before: the Gallery has both images.
    const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
    harness.routeHolder.params = {};
    let gallery = rtl.render(React.createElement(GalleryScreen));
    await rtl.waitFor(() => expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(2));
    expect(gallery.queryByTestId('gallery-image-img-1')).not.toBeNull();
    expect(gallery.queryByTestId('gallery-image-img-2')).not.toBeNull();
    gallery.unmount();

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
      const { HomeScreen } = require('../../../src/screens/HomeScreen');
      screen = rtl.render(React.createElement(HomeScreen, { navigation: homeNavigation }));
      expect(await screen.findByText(title)).toBeTruthy();
      rtl.fireEvent.press(screen.getByTestId('delete-conversation-button'));
    } else {
      harness.routeHolder.params = { projectId };
      const { ProjectDetailScreen } = require('../../../src/screens/ProjectDetailScreen');
      screen = rtl.render(React.createElement(ProjectDetailScreen, {}));
      if (surface === 'project chats') {
        // The project's Chats header opens its full chat list.
        rtl.fireEvent.press(await screen.findByText('Chats'));
        screen.unmount();
        expect(navigatedTo().screen).toBe('ProjectChats');
        harness.routeHolder.params = navigatedTo().params!;
        const { ProjectChatsScreen } = require('../../../src/screens/ProjectChatsScreen');
        screen = rtl.render(React.createElement(ProjectChatsScreen, {}));
      }
      expect(await screen.findByText(title)).toBeTruthy();
      rtl.fireEvent.press(screen.getByLabelText(`Delete ${title}`));
    }
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Delete')); });

    // The chat is gone, and the user is told one image stayed and where to find it.
    expect(await screen.findByText('Some images were not deleted')).toBeTruthy();
    expect(screen.getByText(/1 image from the deleted chat could not be removed/)).toBeTruthy();
    expect(screen.queryByText(title)).toBeNull();
    screen.unmount();

    // The image that could be removed is off the disk and out of the Gallery; the one that stayed is listed.
    expect(await fs.exists(freeImage)).toBe(false);
    expect(await fs.exists(lockedImage)).toBe(true);
    harness.routeHolder.params = {};
    gallery = rtl.render(React.createElement(GalleryScreen));
    await rtl.waitFor(() => expect(gallery.queryAllByTestId(/^gallery-image-/)).toHaveLength(1));
    expect(gallery.queryByTestId('gallery-image-img-1')).not.toBeNull();
    expect(gallery.queryByTestId('gallery-image-img-2')).toBeNull();
    gallery.unmount();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
