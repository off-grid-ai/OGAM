import { BuildInfo } from 'llama.rn';
import type { ModelEntry } from '@offgrid/models';

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
