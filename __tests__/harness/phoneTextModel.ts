/**
 * A text model on the phone, the way a person gets one: the .gguf they picked from Files is imported
 * through the Models screen's import path (modelManager copies it into the models folder and builds
 * its record), the screen adds it to the list, and the model picker chooses it.
 *
 * The only seeded thing is the file in Downloads, which is the device boundary. Nothing writes the
 * model list or the active model by hand.
 */
import type { FsFake } from './nativeBoundary';
import type { DownloadedModel } from '../../src/types';

/** Import `fileName` (named the way the import names it: "Thinker 8B.gguf" lists as "Thinker 8B"). */
export async function importTextModel(
  fs: FsFake,
  model: { fileName: string; sizeBytes: number },
): Promise<DownloadedModel> {
  const picked = `${fs.module.ExternalStorageDirectoryPath}/Download/${model.fileName}`;
  fs.seedFile(picked, model.sizeBytes);
  const { modelManager } = require('../../src/services/modelManager');
  const { useAppStore } = require('../../src/stores');
  const imported: DownloadedModel = await modelManager.importLocalModel({
    sourceUri: `file://${picked}`,
    fileName: model.fileName,
    sourceSize: model.sizeBytes,
  });
  // What the Models screen does with an imported model (importHelpers.ts).
  useAppStore.getState().addDownloadedModel(imported);
  return imported;
}

/** The model picker's choice. Loading follows on first use, as it does in the app. */
export function pickTextModel(modelId: string): void {
  const { activeModelService } = require('../../src/services/activeModelService');
  activeModelService.selectTextModel(modelId);
}

/** Import one model and pick it: a phone with a text model ready for its first rewrite. */
export async function importAndPickTextModel(
  fs: FsFake,
  model: { fileName: string; sizeBytes: number },
): Promise<DownloadedModel> {
  const { hardwareService } = require('../../src/services/hardware');
  await hardwareService.refreshMemoryInfo();
  const imported = await importTextModel(fs, model);
  pickTextModel(imported.id);
  return imported;
}
