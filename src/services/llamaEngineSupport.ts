import { BuildInfo } from 'llama.rn';
import { baseModelKey, type ModelEntry } from '@offgrid/models';

/** The llama.cpp build inside this app's engine (llama.rn), or undefined when unknown. */
export function engineLlamaBuild(): number | undefined {
  const build = Number.parseInt(String(BuildInfo?.number ?? ''), 10);
  return Number.isFinite(build) ? build : undefined;
}

/** Whether this app's engine loads a catalog model. An unknown engine build never loads a model
 *  that needs a specific newer one. The one rule for every list that offers a model. */
export function engineLoadsCatalogModel(entry: Pick<ModelEntry, 'minLlamaBuild'>): boolean {
  return !(entry.minLlamaBuild && entry.minLlamaBuild > (engineLlamaBuild() ?? 0));
}

/** A test for Hugging Face results: true for any upload of a catalog model this engine cannot load
 *  (the catalog's copy or another uploader's, matched by the shared base-model key). */
export function hfUploadNeedsNewerEngine(catalog: readonly ModelEntry[]): (repoId: string) => boolean {
  const unloadable = new Set(catalog.filter(entry => !engineLoadsCatalogModel(entry)).map(entry => baseModelKey(entry.id)));
  return repoId => unloadable.has(baseModelKey(repoId));
}
