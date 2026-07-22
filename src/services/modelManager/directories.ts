import RNFS from 'react-native-fs';
import { APP_CONFIG } from '../../constants';
import { backgroundDownloadService } from '../backgroundDownloadService';

export async function initializeModelDirectories(
  modelsDir: string,
  imageModelsDir: string,
): Promise<void> {
  if (!(await RNFS.exists(modelsDir))) await RNFS.mkdir(modelsDir);
  if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
  await Promise.all(
    [
      modelsDir,
      imageModelsDir,
      `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`,
    ].map(path => backgroundDownloadService.excludeFromBackup(path)),
  );
}
