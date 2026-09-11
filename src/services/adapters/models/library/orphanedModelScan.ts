import RNFS from 'react-native-fs';
import type { DownloadedModel, ONNXImageModel } from '../../../../types';
import { sizeToBytes } from '../../../../utils/fileSize';

export interface OrphanedModelArtifact {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

/** Find files that no durable text-model row owns. This function does not mutate storage. */
export async function getOrphanedTextFiles(
  modelsDir: string,
  modelsGetter: () => Promise<DownloadedModel[]>,
): Promise<OrphanedModelArtifact[]> {
  if (!(await RNFS.exists(modelsDir))) return [];
  const [files, models] = await Promise.all([RNFS.readDir(modelsDir), modelsGetter()]);
  const trackedPaths = new Set(models.flatMap(model => [
    model.filePath,
    ...(model.engine === 'llama' && model.mmProjPath ? [model.mmProjPath] : []),
  ]));
  return files
    .filter(file => file.isFile() && !trackedPaths.has(file.path))
    .map(file => ({ name: file.name, path: file.path, size: sizeToBytes(file.size) }));
}

function directoryEntrySize(value: string | number): number {
  return typeof value === 'string' ? Number.parseInt(value, 10) : value;
}

async function directorySize(path: string): Promise<number> {
  const files = await RNFS.readDir(path);
  return files.reduce(
    (total, file) => total + (file.isFile() ? directoryEntrySize(file.size) : 0),
    0,
  );
}

/** Find files or directories that no durable image-model row owns. This function does not mutate storage. */
export async function getOrphanedImageDirs(
  imageModelsDir: string,
  imageModelsGetter: () => Promise<ONNXImageModel[]>,
): Promise<OrphanedModelArtifact[]> {
  if (!(await RNFS.exists(imageModelsDir))) return [];
  const [items, models] = await Promise.all([
    RNFS.readDir(imageModelsDir),
    imageModelsGetter(),
  ]);
  const trackedPaths = models.map(model => model.modelPath);
  const orphaned = items.filter(item => !trackedPaths.some(
    path => path === item.path || path.startsWith(`${item.path}/`),
  ));
  return Promise.all(orphaned.map(async item => ({
    name: item.name,
    path: item.path,
    size: item.isDirectory() ? await directorySize(item.path) : directoryEntrySize(item.size),
  })));
}
