import { Alert } from 'react-native';
import { modelManager } from '../../services';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { DownloadedModel } from '../../types';

export type GgufFileRef = { uri: string; name: string; size: number };

export type GgufImportDeps = {
  setAlertState: (s: AlertState) => void;
  setImportProgress: (p: { fraction: number; fileName: string } | null) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
};

export function isMmProj(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('mmproj') ||
    lower.includes('projector') ||
    (lower.includes('clip') && lower.endsWith('.gguf'))
  );
}

/** An MTP (multi-token prediction) / draft file rather than a model of its own. */
export function isDraftFile(name: string): boolean {
  return /(^|[-_.\s])(mtp|nextn|draft)([-_.\s]|\.gguf$)/i.test(name);
}

export function classifyGgufPair(
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
    if (!isLitert && isMmProj(resolvedFileName)) {
      setAlertState(showAlert('This is a vision file', `"${resolvedFileName}" is a vision (mmproj) file, not a model. Import the model first, then open My models and tap "Add vision file" on it.`));
      return;
    }

    // "MTP" in the name is either a complete model with MTP layers built in, or just the small MTP file for another model.
    let embeddedMtp = false;
    if (!isLitert && isDraftFile(resolvedFileName)) {
      const answer = await new Promise<'model' | 'file' | 'cancel'>(resolve => {
        Alert.alert(
          'MTP in the file name',
          `"${resolvedFileName}" has MTP in its name. Is it a complete model with MTP built in (usually over 1 GB), or only the small MTP file to attach to another model?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
            { text: 'Only the MTP file', onPress: () => resolve('file') },
            { text: 'Complete model', onPress: () => resolve('model') },
          ],
          { cancelable: false },
        );
      });
      if (answer === 'cancel') return;
      if (answer === 'file') {
        setAlertState(showAlert('Add it to a model', `Import the model first, then open My models and tap "Add MTP file" on it. Or pick the model and "${resolvedFileName}" together here.`));
        return;
      }
      embeddedMtp = true;
    }

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
    if (embeddedMtp) {
      await modelManager.setEmbeddedMtp(model.id, true);
      setAlertState(showAlert('Success', `${model.name} imported with MTP built in. It will draft tokens with it when it loads (Settings > Text generation > Use MTP files).`));
      return;
    }
    if (!isLitert && looksLikeVisionModel(resolvedFileName)) {
      const add = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Vision model?',
          `${model.name} looks like a model that can see pictures. To use pictures it also needs its vision file (a .gguf with "mmproj" in the name, from the same download page). Add it now?`,
          [{ text: 'Later', style: 'cancel', onPress: () => resolve(false) }, { text: 'Add vision file', onPress: () => resolve(true) }],
          { cancelable: false },
        );
      });
      if (add) { await pickAndAttachMmProj(model.id, model.name, deps); return; }
    }
    setAlertState(showAlert('Success', `${model.name} imported successfully!`));
    return;
  }

  const file1: GgufFileRef = { uri: files[0].uri, name: files[0].name ?? '', size: files[0].size ?? 0 };
  const file2: GgufFileRef = { uri: files[1].uri, name: files[1].name ?? '', size: files[1].size ?? 0 };

  if (isDraftFile(file1.name) !== isDraftFile(file2.name)) {
    const draftFile = isDraftFile(file1.name) ? file1 : file2;
    const modelFile = draftFile === file1 ? file2 : file1;
    const model = await modelManager.importLocalModel({
      sourceUri: modelFile.uri, fileName: modelFile.name, sourceSize: modelFile.size,
      onProgress: p => setImportProgress({ fraction: p.fraction * 0.8, fileName: p.fileName }),
    });
    addDownloadedModel(model);
    try {
      await modelManager.attachDraft(model.id, { uri: draftFile.uri, fileName: draftFile.name, size: draftFile.size }, f => setImportProgress({ fraction: 0.8 + f * 0.2, fileName: draftFile.name }));
      setAlertState(showAlert('Success', `${model.name} imported with its MTP file.`));
    } catch (e) {
      setAlertState(showAlert('Model imported, MTP file not added', getErrorMessage(e)));
    }
    return;
  }

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

/** Names of models that usually come with a separate vision (mmproj) file. */
export function looksLikeVisionModel(name: string): boolean {
  return /(^|[-_.\s])(vl|vlm|vision|llava|bakllava|minicpm-?v|smolvlm|moondream|internvl|pixtral|gemma-?3(?!n)|gemma-?4|qwen2\.5-?omni|granite-vision|mistral-small-3\.[12]|llama-?4|kimi-vl|ui-tars|omni)/i.test(name);
}

/** Pick a vision (mmproj) .gguf from the phone and attach it to a model that is already imported. */
export async function pickAndAttachMmProj(modelId: string, modelName: string, deps: Pick<GgufImportDeps, 'setAlertState' | 'setImportProgress'>): Promise<boolean> {
  const { pick, types } = require('@react-native-documents/picker');
  let file: { uri: string; name: string | null; size: number | null } | undefined;
  try { file = (await pick({ type: [types.allFiles], allowMultiSelection: false }))?.[0]; } catch { return false; }
  if (!file) return false;
  const name = (file.name || decodeURIComponent(file.uri.split('/').pop() || '')).trim();
  if (!name.toLowerCase().endsWith('.gguf')) { deps.setAlertState(showAlert('Not a vision file', 'Pick the .gguf vision file (it usually has "mmproj" in its name).')); return false; }
  try {
    deps.setImportProgress({ fraction: 0, fileName: name });
    await modelManager.attachMmProj(modelId, { uri: file.uri, fileName: name, size: file.size ?? undefined }, (f) => deps.setImportProgress({ fraction: f, fileName: name }));
    deps.setAlertState(showAlert('Vision added', `${modelName} can now look at pictures. Reload the model (or restart the chat) to use it.`));
    return true;
  } catch (e) {
    deps.setAlertState(showAlert('Could not add the vision file', getErrorMessage(e)));
    return false;
  } finally { deps.setImportProgress(null); }
}

/** Pick an MTP (draft) .gguf from the phone and attach it to a model that is already imported. */
export async function pickAndAttachDraft(modelId: string, modelName: string, deps: Pick<GgufImportDeps, 'setAlertState' | 'setImportProgress'>): Promise<boolean> {
  const { pick, types } = require('@react-native-documents/picker');
  let file: { uri: string; name: string | null; size: number | null } | undefined;
  try { file = (await pick({ type: [types.allFiles], allowMultiSelection: false }))?.[0]; } catch { return false; }
  if (!file) return false;
  const name = (file.name || decodeURIComponent(file.uri.split('/').pop() || '')).trim();
  if (!name.toLowerCase().endsWith('.gguf')) { deps.setAlertState(showAlert('Not an MTP file', 'Pick the .gguf MTP (draft) file.')); return false; }
  try {
    deps.setImportProgress({ fraction: 0, fileName: name });
    await modelManager.attachDraft(modelId, { uri: file.uri, fileName: name, size: file.size ?? undefined }, (f) => deps.setImportProgress({ fraction: f, fileName: name }));
    deps.setAlertState(showAlert('MTP file added', `${modelName} will draft with it. Reload the model (or restart the chat) to use it.`));
    return true;
  } catch (e) {
    deps.setAlertState(showAlert('Could not add the MTP file', getErrorMessage(e)));
    return false;
  } finally { deps.setImportProgress(null); }
}
