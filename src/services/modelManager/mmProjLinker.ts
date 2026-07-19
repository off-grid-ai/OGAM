import RNFS from 'react-native-fs';
import { DownloadedModel } from '../../types';
import logger from '../../utils/logger';
import { useAppStore } from '../../stores';
import { mmProjBelongsToModel, pickMmProjForModel } from '../mmproj';
import { isMMProjFile } from './scan';
import { saveModelsList } from './storage';

interface LinkOrphanMmProjOptions {
  modelsDir: string;
  getModels: () => Promise<DownloadedModel[]>;
  saveModelWithMmproj: (modelId: string, path: string) => Promise<void>;
}

export async function linkOrphanMmProj({
  modelsDir,
  getModels,
  saveModelWithMmproj,
}: LinkOrphanMmProjOptions): Promise<void> {
  const models = await getModels();
  let dirFiles: RNFS.ReadDirResItemT[] = [];
  try {
    dirFiles = await RNFS.readDir(modelsDir);
  } catch {
    return;
  }
  const projectors = dirFiles.filter(
    file => file.isFile() && isMMProjFile(file.name),
  );
  if (projectors.length === 0) return;

  const updatedLinks: DownloadedModel[] = [];
  for (const model of models) {
    if (model.engine !== 'llama') continue;
    const chosenName = pickMmProjForModel(
      model.fileName,
      projectors.map(file => file.name),
    );
    const match = chosenName
      ? projectors.find(file => file.name === chosenName)
      : undefined;

    if (model.mmProjPath) {
      const belongs = mmProjBelongsToModel(
        model.fileName,
        model.mmProjPath.split('/').pop() ?? '',
      );
      const fileExists = await RNFS.exists(model.mmProjPath).catch(() => false);
      if (!fileExists || !belongs) {
        logger.log(
          `[linkOrphanMmProj] ${model.id} — clearing bad link: ${model.mmProjPath}`,
        );
        updatedLinks.push({
          ...model,
          mmProjPath: undefined,
          mmProjFileSize: undefined,
          isVisionModel: true,
        });
      }
    } else if (match) {
      logger.log(`[linkOrphanMmProj] ${model.id} — linking ${match.path}`);
      await saveModelWithMmproj(model.id, match.path);
    }
  }

  if (updatedLinks.length === 0) return;
  const current = await getModels();
  const updated = current.map(
    model => updatedLinks.find(saved => saved.id === model.id) ?? model,
  );
  await saveModelsList(updated);
  useAppStore.getState().setDownloadedModels(updated);
}
