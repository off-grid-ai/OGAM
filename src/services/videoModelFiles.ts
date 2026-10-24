import RNFS from 'react-native-fs';
import type { ModelEntry } from '@offgrid/models';
import {
  videoPackError,
  videoPackFiles,
  type VideoModelPack,
} from '@offgrid/models';

export interface VideoModel extends ModelEntry {
  kind: 'video';
  downloadedAt: string;
}
export const videoModelsDirectory = () =>
  `${RNFS.DocumentDirectoryPath}/video-models`;
export const videoModelDirectory = (id: string) =>
  `${videoModelsDirectory()}/${encodeURIComponent(id)}`;
export function validateVideoPack(model: ModelEntry): void {
  const error = videoPackError(model.files);
  if (model.kind !== 'video' || error)
    throw new Error(error ?? 'This is not a video model.');
}
export async function resolveVideoPack(
  model: ModelEntry,
  verifyChecksum = false,
) {
  validateVideoPack(model);
  const directory = videoModelDirectory(model.id);
  for (const file of model.files) {
    const stat = await RNFS.stat(`${directory}/${file.name}`);
    if (
      !stat.isFile() ||
      Number(stat.size) <= 0 ||
      (file.sizeBytes && Number(stat.size) !== file.sizeBytes)
    )
      throw new Error(`Video model file is incomplete: ${file.name}`);
    if (
      verifyChecksum &&
      file.sha256 &&
      (await RNFS.hash(`${directory}/${file.name}`, 'sha256')).toLowerCase() !==
        file.sha256.toLowerCase()
    )
      throw new Error(`Video model checksum failed: ${file.name}`);
  }
  const weight = model.files.find(f => f.role === 'primary')!.name;
  return Object.fromEntries(
    Object.entries(videoPackFiles(weight)!).map(([role, name]) => [
      role,
      `${directory}/${name}`,
    ]),
  ) as unknown as VideoModelPack;
}
