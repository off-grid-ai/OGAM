/**
 * Deleting a chat from the Chats list removes the videos made in it, from the disk and the Gallery.
 * A video file the device refuses to remove keeps its record, so the person can delete it again.
 *
 * Real ChatsListScreen and the real chat and app stores. The device filesystem is the in-memory native
 * boundary; it refuses one unlink, as a locked file does on device.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

it('removes the chat\'s videos, file first, and keeps a video whose file stays', async () => {
  const boundary = installNativeBoundary({ fs: true });
  const fs = boundary.fs!;
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const updatedAt = '2026-10-27T12:00:00.000Z';
  await AsyncStorage.setItem(
    'local-llm-chat-storage',
    JSON.stringify({
      state: {
        conversations: [{
          id: 'chat-fox', title: 'Fox clips', modelId: 'remote-model',
          messages: [{ id: 'm1', role: 'user', content: 'a fox in snow', timestamp: Date.parse(updatedAt) }],
          createdAt: updatedAt, updatedAt,
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

  const saveVideo = (id: string, conversationId: string) => {
    const videoPath = `${fs.DocumentDirectoryPath}/generated-videos/${id}.mp4`;
    fs.seedFile(videoPath, 4096);
    useAppStore.getState().addGeneratedVideo({
      id, prompt: 'a fox in snow', videoPath, width: 480, height: 832, fps: 16, frames: 33, durationSeconds: 2,
      steps: 20, guidance: 5, seed: 1, modelId: 'wan', createdAt: updatedAt, conversationId,
    });
    return videoPath;
  };
  const freeVideo = saveVideo('vid-free', 'chat-fox');
  const lockedVideo = saveVideo('vid-locked', 'chat-fox');
  const otherChatVideo = saveVideo('vid-other', 'chat-other');
  const unlink = fs.module.unlink.getMockImplementation()!;
  fs.module.unlink.mockImplementation(async (path: string) => {
    if (path === lockedVideo) throw new Error('EACCES: permission denied');
    return unlink(path);
  });

  const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
  const chats = rtl.render(React.createElement(ChatsListScreen));
  rtl.fireEvent.press(chats.getByLabelText('Delete Fox clips'));
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
  await rtl.act(async () => { rtl.fireEvent.press(chats.getByText('Delete')); });

  await rtl.waitFor(() => expect(chats.queryByText('Fox clips')).toBeNull());
  await rtl.waitFor(async () => expect(await fs.exists(freeVideo)).toBe(false));
  expect(await fs.exists(lockedVideo)).toBe(true);
  expect(await fs.exists(otherChatVideo)).toBe(true);
  chats.unmount();

  // The Gallery lists the video that stayed and the other chat's video, not the one removed.
  const { GalleryScreen } = require('../../../src/screens/GalleryScreen');
  const gallery = rtl.render(React.createElement(GalleryScreen));
  expect(await gallery.findByText('Videos (2)')).toBeTruthy();
  gallery.unmount();
});
