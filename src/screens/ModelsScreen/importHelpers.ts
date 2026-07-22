import { Alert } from 'react-native';
import { modelManager } from '../../services';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { DownloadedModel } from '../../types';

type GgufFileRef = { uri: string; name: string; size: number };

export type GgufImportDeps = {
  setAlertState: (s: AlertState) => void;
  setImportProgress: (p: { fraction: number; fileName: string } | null) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
};

function isMmProj(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('mmproj') ||
    lower.includes('projector') ||
    (lower.includes('clip') && lower.endsWith('.gguf'))
  );
}

function classifyGgufPair(
  file1: GgufFileRef,
  file2: GgufFileRef,
): { mainFile: GgufFileRef; mmProjFile: GgufFileRef } {
  if (isMmProj(file1.name)) return { mainFile: file2, mmProjFile: file1 };
  if (isMmProj(file2.name)) return { mainFile: file1, mmProjFile: file2 };
  if (file1.size > 0 && file2.size > 0) {
    return file1.size >= file2.size
      ? { mainFile: file1, mmProjFile: file2 }
      : { mainFile: file2, mmProjFile: file1 };
  }
  return { mainFile: file1, mmProjFile: file2 };
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

  if (files.length === 1) {
    const resolvedFileName = files[0].name ?? 'unknown';
    const isLitert = resolvedFileName.toLowerCase().endsWith('.litertlm');

    let liteRTVision = false;
    if (isLitert) {
      liteRTVision = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Vision Support',
          'Does this model support image/vision input?\n\nEnable this only for multimodal models (e.g. Gemma 3n). Enabling it on a text-only model will cause a load error.',
          [
            { text: 'Text Only', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Vision', style: 'default', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
    }

    const model = await modelManager.importLocalModel({
      sourceUri: files[0].uri,
      fileName: resolvedFileName,
      sourceSize: files[0].size,
      engine: isLitert ? 'litert' : undefined,
      liteRTVision: isLitert ? liteRTVision : undefined,
      onProgress: p => {
        setImportProgress(p);
      },
    });
    addDownloadedModel(model);
    setAlertState(showAlert('Success', `${model.name} imported successfully!`));
    return;
  }

  const file1: GgufFileRef = { uri: files[0].uri, name: files[0].name ?? '', size: files[0].size ?? 0 };
  const file2: GgufFileRef = { uri: files[1].uri, name: files[1].name ?? '', size: files[1].size ?? 0 };

  const { mainFile, mmProjFile } = classifyGgufPair(file1, file2);

  const confirmed = await new Promise<boolean>(resolve => {
    Alert.alert(
      'Import Vision Model?',
      `Main model:  ${mainFile.name}\nProjector:    ${mmProjFile.name}\n\nIf these look wrong, cancel and rename your files.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Import', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });

  if (!confirmed) {
    return;
  }

  const model = await modelManager.importLocalModel({
    sourceUri: mainFile.uri,
    fileName: mainFile.name,
    sourceSize: mainFile.size,
    onProgress: p => {
      setImportProgress(p);
    },
    mmProjSourceUri: mmProjFile.uri,
    mmProjFileName: mmProjFile.name,
    mmProjSourceSize: mmProjFile.size,
  });
  addDownloadedModel(model);
  setAlertState(showAlert('Success', `${model.name} imported with vision projector!`));
}
