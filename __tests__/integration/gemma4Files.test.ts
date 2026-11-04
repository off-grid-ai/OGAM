/**
 * The Gemma4-12B-QAT-Uncensored-HauhauCS file set as it sits in the models folder: the model, its vision projector and the
 * MTP file attached to it. The projector pairs with the model whatever the quantization in either name, and neither
 * helper file is ever offered as a model of its own by the recovery scan. Fakes only the file system.
 */
import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';

const MODEL = 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf';
const PROJECTOR = 'mmproj-Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf';
const MTP = 'mtp-gemma-4-12B-it.gguf';

it('pairs the projector with the model, and the recovery scan offers neither the projector nor the attached MTP file as a model', async () => {
  const boundary = installNativeBoundary({ fs: true });
  requireRTL();
  const { mmProjBelongsToModel, pickMmProjForModel, isMMProjFile } = require('../../src/services/mmproj');
  const { scanForUntrackedTextModels } = require('../../src/services/modelManager/scan');

  expect(isMMProjFile(PROJECTOR)).toBe(true);
  expect(isMMProjFile(MODEL)).toBe(false);
  expect(mmProjBelongsToModel(MODEL, PROJECTOR)).toBe(true);
  expect(pickMmProjForModel(MODEL, [PROJECTOR, 'mmproj-gemma-4-E2B-it-BF16.gguf'])).toBe(PROJECTOR);

  const dir = '/models';
  const attachedMtp = `${dir}/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.mtp-${MTP}`;
  boundary.fs!.seedFile(`${dir}/${MODEL}`, 300 * 1024 * 1024);
  boundary.fs!.seedFile(`${dir}/${PROJECTOR}`, 300 * 1024 * 1024);
  boundary.fs!.seedFile(attachedMtp, 300 * 1024 * 1024);

  // The model is registered with its MTP file attached; only a stray, unregistered .gguf should be recovered.
  const registered = [{ id: 'm', name: 'g', fileName: MODEL, filePath: `${dir}/${MODEL}`, engine: 'llama', draftPath: attachedMtp }];
  const found = await scanForUntrackedTextModels(dir, async () => registered);
  expect(found.map((m: { fileName: string }) => m.fileName)).toEqual([]);

  // Same folder, MTP file not recorded on the model (an older install): its Atlas-made name still keeps it out of the list.
  const withoutRecord = await scanForUntrackedTextModels(dir, async () => [{ ...registered[0], draftPath: undefined }]);
  expect(withoutRecord.map((m: { fileName: string }) => m.fileName)).toEqual([]);
});

it('judges a model file by size and checksum even when the file was renamed', () => {
  const { judgeFile, describeFileVerdict, KNOWN_MODEL_FILES } = require('../../src/services/knownModelFiles');
  const real = KNOWN_MODEL_FILES[0];
  expect(judgeFile(real.bytes, real.sha256).kind).toBe('match');
  expect(describeFileVerdict(judgeFile(real.bytes, real.sha256.toUpperCase()))).toMatch(/^OK: 7,381,381,760 bytes, identical to the published Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M\.gguf/);
  // Right size, wrong bytes: the copy on the phone is damaged.
  expect(describeFileVerdict(judgeFile(real.bytes, '0'.repeat(64)))).toMatch(/^DAMAGED:.*delete it and copy or download it again/);
  // A file Atlas knows nothing about is reported with its checksum, not called good or bad.
  expect(describeFileVerdict(judgeFile(123, 'abc'))).toMatch(/not in the list of known files \(123 bytes, SHA-256 abc\)/);
});

it('imports a model again when the saved list still has an entry for the same file name, replacing it instead of saying it is already in the list', async () => {
  const boundary = installNativeBoundary({ fs: true });
  requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const RNFS = require('react-native-fs');
  const { importLocalModel } = require('../../src/services/modelManager/scan');
  const dir = '/models';
  const dest = `${dir}/${MODEL}`;
  // What a removal left behind: the file in the folder (an older, different copy) and its entry in the saved list.
  boundary.fs!.seedFile(dest, 6 * 1024 * 1024);
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify([
    { id: `local_import/${MODEL}`, name: 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced', fileName: MODEL, filePath: dest, fileSize: 6 * 1024 * 1024, engine: 'llama' },
  ]));
  boundary.fs!.seedFile('/downloads/picked.gguf', 7 * 1024 * 1024);

  const model = await importLocalModel({ sourceUri: 'file:///downloads/picked.gguf', fileName: MODEL, modelsDir: dir, sourceSize: 7 * 1024 * 1024 });
  expect(model.id).toBe(`local_import/${MODEL}`);
  expect(Number((await RNFS.stat(dest)).size)).toBe(7 * 1024 * 1024); // the picked file's bytes, not the old copy's
  const { loadDownloadedModels } = require('../../src/services/modelManager/storage');
  const list = await loadDownloadedModels(dir);
  expect(list.filter((m: { fileName: string }) => m.fileName === MODEL)).toHaveLength(1);
});
