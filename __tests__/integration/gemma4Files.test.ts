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
