import RNFS from 'react-native-fs';
import { resolveDocumentPath } from '../utils/resolveDocumentPath';
import { useAppStore, useChatStore } from '../stores';

/** Delete a saved video and its chat attachment. Free: a person keeps control of their videos
 *  after Pro ends. */
export async function deleteGeneratedVideo(id: string): Promise<void> {
  const video = useAppStore
    .getState()
    .generatedVideos.find(item => item.id === id);
  if (!video) return;
  const path = resolveDocumentPath(video.videoPath);
  const root = `${RNFS.DocumentDirectoryPath}/`;
  if (!path.startsWith(root) || path.split('/').includes('..'))
    throw new Error('The video path is outside app storage.');
  if (await RNFS.exists(path)) await RNFS.unlink(path);
  useChatStore.getState().removeMediaAttachment(id);
  useAppStore.getState().removeGeneratedVideo(id);
}
