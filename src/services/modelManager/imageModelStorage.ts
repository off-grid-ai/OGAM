import RNFS from 'react-native-fs';
import { ONNXImageModel } from '../../types';
import { loadDownloadedImageModels, saveImageModelsList } from './storage';

export async function getDownloadedImageModels(
  imageModelsDir: string,
): Promise<ONNXImageModel[]> {
  try {
    return await loadDownloadedImageModels(imageModelsDir);
  } catch {
    return [];
  }
}

export async function addDownloadedImageModel(
  imageModelsDir: string,
  model: ONNXImageModel,
): Promise<void> {
  const models = await getDownloadedImageModels(imageModelsDir);
  const index = models.findIndex(candidate => candidate.id === model.id);
  if (index >= 0) models[index] = model;
  else models.push(model);
  await saveImageModelsList(models);
}

export async function deleteImageModel(
  imageModelsDir: string,
  modelId: string,
): Promise<void> {
  const models = await getDownloadedImageModels(imageModelsDir);
  const model = models.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('Image model not found');

  const topLevelDir = `${imageModelsDir}/${modelId}`;
  if (!topLevelDir.startsWith(`${imageModelsDir}/`)) {
    throw new Error('Invalid image model path: outside app directory');
  }
  if (await RNFS.exists(topLevelDir)) await RNFS.unlink(topLevelDir);
  await saveImageModelsList(
    models.filter(candidate => candidate.id !== modelId),
  );
}

export async function getImageModelPath(
  imageModelsDir: string,
  modelId: string,
): Promise<string | null> {
  const models = await getDownloadedImageModels(imageModelsDir);
  return models.find(model => model.id === modelId)?.modelPath || null;
}

export async function getImageModelsStorageUsed(
  imageModelsDir: string,
): Promise<number> {
  const models = await getDownloadedImageModels(imageModelsDir);
  return models.reduce((total, model) => total + model.size, 0);
}
