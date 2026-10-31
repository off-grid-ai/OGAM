import RNFS from 'react-native-fs';
import { useAppStore } from '../stores/appStore';
import { resolveDocumentPath } from '../utils/resolveDocumentPath';
import { statFile } from '../utils/fileStat';
import { videoModelDirectory } from './videoModelFiles';
import { ragDatabase } from './rag/database';

const fileBytes = async (path: string): Promise<number> => {
  const facts = await statFile(path);
  return facts?.isFile ? facts.size : 0;
};

/** Saved videos and films, which stay playable without Pro. */
export async function generatedVideoBytes(): Promise<number> {
  const sizes = await Promise.all(
    useAppStore.getState().generatedVideos.map(video => fileBytes(resolveDocumentPath(video.videoPath))),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

/** Downloaded search (embedding) models; the built-in one ships with the app. */
export async function searchModelBytes(): Promise<number> {
  const entries = await RNFS.readDir(RNFS.DocumentDirectoryPath).catch(() => []);
  return entries
    .filter(entry => entry.isFile() && /^embedding-.*\.gguf$/.test(entry.name))
    .reduce((total, entry) => total + Number(entry.size), 0);
}

/** The document search index. */
export async function documentIndexBytes(): Promise<number> {
  await ragDatabase.ensureReady().catch(() => undefined);
  const path = ragDatabase.filePath();
  return path ? fileBytes(path) : 0;
}

/** Delete a video model pack and its record. Free: storage stays the person's after Pro ends. */
export async function deleteVideoPack(id: string): Promise<void> {
  await RNFS.unlink(videoModelDirectory(id)).catch(() => undefined);
  const app = useAppStore.getState();
  app.removeDownloadedVideoModel(id);
  if (app.activeVideoModelId === id) app.setActiveVideoModelId(null);
}
