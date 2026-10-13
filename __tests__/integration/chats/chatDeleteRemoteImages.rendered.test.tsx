/**
 * Deleting a chat removes the images generated in it, whatever their format (backlog item 3).
 *
 * A remote server can return JPEG or WebP. The native image store only knows <id>.png, so the
 * delete must use each image's saved path. The real chat and app stores and the real chats screen
 * run; the device filesystem and the diffusion module are the in-memory native boundary.
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
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Deleting a chat with generated images', () => {
  it('removes its remote JPEG and WebP files and keeps another chat’s image', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const fs = boundary.fs!;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const updatedAt = '2026-09-15T12:00:00.000Z';
    const chat = (id: string, title: string) => ({
      id,
      title,
      modelId: 'remote-model',
      messages: [
        { id: `${id}-m`, role: 'user', content: title, timestamp: Date.parse(updatedAt) },
      ],
      createdAt: updatedAt,
      updatedAt,
    });
    await AsyncStorage.setItem(
      'local-llm-chat-storage',
      JSON.stringify({
        state: {
          conversations: [chat('chat-trip', 'Trip photos'), chat('chat-logo', 'Logo ideas')],
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
    const saveImage = (id: string, extension: string, conversationId: string) => {
      const imagePath = `${imagesDir}/${id}.${extension}`;
      fs.seedFile(imagePath, 2048);
      useAppStore.getState().addGeneratedImage({
        id,
        prompt: 'a lake at dawn',
        imagePath,
        width: 512,
        height: 512,
        steps: 1,
        seed: 1,
        modelId: 'remote-model',
        createdAt: updatedAt,
        conversationId,
      });
      return imagePath;
    };
    const tripJpeg = saveImage('img-trip-1', 'jpg', 'chat-trip');
    const tripWebp = saveImage('img-trip-2', 'webp', 'chat-trip');
    const logoJpeg = saveImage('img-logo-1', 'jpg', 'chat-logo');

    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const chats = rtl.render(React.createElement(ChatsListScreen));

    rtl.fireEvent.press(chats.getByLabelText('Select chats'));
    rtl.fireEvent.press(chats.getByText('Trip photos'));
    expect(chats.getByText('1 selected')).toBeTruthy();
    rtl.fireEvent.press(chats.getByLabelText('Delete selected chats'));
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    rtl.fireEvent.press(chats.getByText('Delete'));

    await rtl.waitFor(async () => {
      expect(await fs.exists(tripJpeg)).toBe(false);
      expect(await fs.exists(tripWebp)).toBe(false);
    });
    expect(await fs.exists(logoJpeg)).toBe(true);
    expect(chats.queryByText('Trip photos')).toBeNull();
    expect(chats.getByText('Logo ideas')).toBeTruthy();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
