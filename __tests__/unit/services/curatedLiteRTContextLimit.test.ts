import { CURATED_LITERT_ENTRIES, getCuratedLiteRTContextLimit, LITERT_PARENT_ID } from '../../../src/services/curatedLiteRTRegistry';
import { createDownloadedModel } from '../../utils/factories';

const ENTRIES_WITH_LIMIT = CURATED_LITERT_ENTRIES.filter(e => e.maxContextTokens !== undefined);

it.each(ENTRIES_WITH_LIMIT)('matches the pinned artifact for $displayName without changing saved model data', entry => {
  const model = createDownloadedModel({
    engine: 'litert', id: `${LITERT_PARENT_ID}/${entry.fileName}`,
    fileName: entry.fileName, fileSize: entry.sizeBytes,
  });
  expect(getCuratedLiteRTContextLimit(model)).toBe(32000);
  expect(getCuratedLiteRTContextLimit({ ...model, id: 'imported' })).toBeNull();
  expect(getCuratedLiteRTContextLimit({ ...model, fileSize: 1 })).toBeNull();
  const origin = { repoId: entry.hfRepoId, revision: entry.commitHash, path: entry.fileName };
  expect(getCuratedLiteRTContextLimit({ ...model, id: 'transferred', origin })).toBe(32000);
  expect(getCuratedLiteRTContextLimit({ ...model, origin: { ...origin, revision: 'main' } })).toBeNull();
  expect(getCuratedLiteRTContextLimit({ ...model, engine: 'llama' })).toBeNull();
});

it('imposes no catalog context limit on an entry that declares none (the Tensor TPU build)', () => {
  const entry = CURATED_LITERT_ENTRIES.find(e => e.maxContextTokens === undefined)!;
  const model = createDownloadedModel({
    engine: 'litert', id: `${LITERT_PARENT_ID}/${entry.fileName}`,
    fileName: entry.fileName, fileSize: entry.sizeBytes,
  });
  expect(getCuratedLiteRTContextLimit(model)).toBeNull();
});
