import { Alert } from 'react-native';
import { modelLibrary } from '../../services';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { DownloadedModel } from '../../types';
import {
  classifyModelImport,
  isModelProjectorFile,
  type ModelFileImportDecision,
} from '@offgrid/application';
import { importSelectedModelFiles } from '../../services/adapters/models/library/modelFileImportApplicationAdapter';

export type GgufFileRef = { uri: string; name: string; size: number };

export type GgufImportDeps = {
  setAlertState: (s: AlertState) => void;
  setImportProgress: (p: { fraction: number; fileName: string } | null) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
};

export function isMmProj(name: string): boolean {
  return isModelProjectorFile(name);
}

export function classifyGgufPair(
  file1: GgufFileRef,
  file2: GgufFileRef,
): { mainFile: GgufFileRef; mmProjFile: GgufFileRef } {
  const selection = classifyModelImport({
    artifacts: [
      { uri: file1.uri, name: file1.name, sizeBytes: file1.size },
      { uri: file2.uri, name: file2.name, sizeBytes: file2.size },
    ],
    liteRTAvailable: true,
  });
  if (selection.type !== 'text' || !selection.projector) {
    return { mainFile: file1, mmProjFile: file2 };
  }
  return {
    mainFile: {
      uri: selection.primary.uri,
      name: selection.primary.name,
      size: selection.primary.sizeBytes,
    },
    mmProjFile: {
      uri: selection.projector.uri,
      name: selection.projector.name,
      size: selection.projector.sizeBytes,
    },
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export async function importGgufFiles(
  files: Array<{ uri: string; name: string | null; size: number | null }>,
  deps: GgufImportDeps,
): Promise<void> {
  const { setAlertState, setImportProgress, addDownloadedModel } = deps;

  const artifacts = files.map(file => ({
    uri: file.uri,
    name: file.name ?? 'unknown',
    sizeBytes: file.size ?? 0,
  }));
  const decide = (request: ModelFileImportDecision): Promise<boolean> => {
    if (request.type === 'litert-vision') {
      return new Promise<boolean>(resolve => {
        Alert.alert(
          'Vision Support',
          'Does this model support image/vision input?\n\nEnable this only for multimodal models (e.g. Gemma 3n). Enabling it on a text-only model will cause a load error.',
          [
            {
              text: 'Text Only',
              style: 'cancel',
              onPress: () => resolve(false),
            },
            { text: 'Vision', style: 'default', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
    }
    return new Promise<boolean>(resolve =>
      Alert.alert(
        'Import Vision Model?',
        `Main model:  ${request.primary.name}\nProjector:    ${request.projector.name}\n\nIf these look wrong, cancel and rename your files.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Import', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      ),
    );
  };
  const result = await importSelectedModelFiles({
    modelsDir: modelLibrary.getModelsDirectory(),
    artifacts,
    decide,
    onProgress: setImportProgress,
    refresh: addDownloadedModel,
  });
  if (result.status === 'failed') throw new Error(result.error);
  if (result.status === 'cancelled') return;
  setAlertState(
    showAlert(
      'Success',
      result.projector
        ? `${result.model.name} imported with vision projector!`
        : `${result.model.name} imported successfully!`,
    ),
  );
}
