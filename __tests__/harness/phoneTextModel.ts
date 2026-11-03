/**
 * A text model on the phone, the way a person gets one: they tap Import on the Models screen, pick
 * the .gguf in the system file picker, and the screen's own import flow (validation, copy into the
 * models folder, the model list) brings it in. Then the model picker chooses it.
 *
 * Seeded only at the device boundary: the file in Downloads and the picker's answer. The Models
 * screen's hook runs on the real navigation stack. The test file must
 * `jest.unmock('@react-navigation/native')`.
 */
import type { FsFake } from './nativeBoundary';
import type { DownloadedModel } from '../../src/types';
import { renderHookInNavigator } from './navigatorHook';

type ModelsScreen = ReturnType<typeof import('../../src/screens/ModelsScreen/useModelsScreen').useModelsScreen>;

/** Import `fileName` (named the way the import names it: "Thinker 8B.gguf" lists as "Thinker 8B"). */
export async function importTextModel(
  fs: FsFake,
  model: { fileName: string; sizeBytes: number },
): Promise<DownloadedModel> {
  const picked = `${fs.module.ExternalStorageDirectoryPath}/Download/${model.fileName}`;
  fs.seedFile(picked, model.sizeBytes);
  const picker = require('@react-native-documents/picker');
  picker.pick.mockResolvedValueOnce([{ uri: `file://${picked}`, name: model.fileName, size: model.sizeBytes }]);
  const { useModelsScreen } = require('../../src/screens/ModelsScreen/useModelsScreen');
  const screen = await renderHookInNavigator<ModelsScreen>(() => useModelsScreen(), { screen: 'Models' });
  let said = '';
  try {
    await screen.rtl.act(async () => {
      await screen.result.current.handleImportLocalModel();
    });
    const { title, message } = screen.result.current.alertState;
    said = `${title}: ${message}`;
  } finally {
    screen.unmount();
  }
  const { useAppStore } = require('../../src/stores');
  const imported = (useAppStore.getState().downloadedModels as DownloadedModel[]).find(m =>
    m.filePath.endsWith(`/${model.fileName}`),
  );
  if (!imported) throw new Error(`${model.fileName} is not in the model list after import (the screen said "${said}")`);
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
