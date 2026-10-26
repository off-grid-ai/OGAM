import RNFS from 'react-native-fs';
import type { ModelEntry } from '@offgrid/models';

/** Where video model packs live. Core keeps the layout so storage and restore can see the files;
 *  the video product (pack checks, downloads, generation) is in Pro. */
export interface VideoModel extends ModelEntry {
  kind: 'video';
  downloadedAt: string;
}
export const videoModelsDirectory = () =>
  `${RNFS.DocumentDirectoryPath}/video-models`;
export const videoModelDirectory = (id: string) =>
  `${videoModelsDirectory()}/${encodeURIComponent(id)}`;
