import { CATALOG, isLoadableOnDevice, pickModelsForDevice, PHONE_FIT_BUDGET, type FitBudget, type ModelEntry, type PickCandidate } from '@offgrid/models';
import { textModelBudget } from './memoryBudget';
import { registerBundledCatalog, withRemoteCatalog } from '../stores/modelCatalogStore';
import { engineLlamaBuild, engineLoadsCatalogModel } from './llamaEngineSupport';
import type { ModelFile, ModelInfo } from '../types';

/** A catalog model this phone may offer: not replaced by a newer one, and loadable by its engine. */
function isOfferable(entry: Pick<ModelEntry, 'supersededBy' | 'minLlamaBuild'>): boolean {
  return !entry.supersededBy && engineLoadsCatalogModel(entry);
}

/**
 * Three chat models for this phone, Fast, Balanced and Best, from the shared catalog and the shared
 * picking rule with the phone budget. Desktop draws the same picks from the same rule; this is only
 * the mapping into the phone's download types.
 */
export type PickSlot = 'fast' | 'balanced' | 'best';

export interface DevicePick {
  slot: PickSlot;
  model: ModelInfo;
  file: ModelFile;
  /** Weights plus the vision projector: what the phone downloads. */
  sizeBytes: number;
}

registerBundledCatalog('models', CATALOG);

/** The bundled catalog plus the pool a check fetched. Screens pass `useWithRemoteCatalog('models',
 *  CATALOG)` in, so they re-render when a check changes the pool. */
function phoneCatalog(): ModelEntry[] {
  return withRemoteCatalog('models', CATALOG);
}

/** The chat models a phone can download from the catalog: ready, chat or vision, one entry per
 *  model (quantization variants are options of their base model, not separate picks). */
function chatEntries(catalog: readonly ModelEntry[]): ModelEntry[] {
  return catalog.filter(entry =>
    (entry.kind === 'text' || entry.kind === 'vision') &&
    entry.availability !== 'coming_soon' &&
    !entry.grounder &&
    !entry.quantOf &&
    isOfferable(entry) &&
    entry.files.some(file => file.role === 'primary' || file.role === undefined),
  );
}

/** A catalog entry as the phone's download request: the primary weights plus the projector. */
function catalogEntryToDownload(entry: ModelEntry): { model: ModelInfo; file: ModelFile } | null {
  const primary = entry.files.find(file => file.role === 'primary') ?? entry.files.find(file => file.role === undefined);
  if (!primary?.sizeBytes) return null;
  const mmproj = entry.files.find(file => file.role === 'mmproj');
  const file: ModelFile = {
    name: primary.name,
    size: primary.sizeBytes,
    quantization: entry.quant ?? 'Unknown',
    downloadUrl: primary.url,
    ...(primary.sha256 ? { sha256: primary.sha256 } : {}),
    ...(mmproj?.sizeBytes ? {
      mmProjFile: {
        name: mmproj.name,
        size: mmproj.sizeBytes,
        downloadUrl: mmproj.url,
        ...(mmproj.sha256 ? { sha256: mmproj.sha256 } : {}),
      },
    } : {}),
  };
  const model: ModelInfo = {
    id: entry.id,
    name: entry.name,
    author: entry.org ?? entry.id.split('/')[0],
    description: entry.description ?? '',
    downloads: 0,
    likes: 0,
    tags: [],
    lastModified: '',
    files: [file],
    modelType: entry.kind === 'vision' ? 'vision' : 'text',
    ...(entry.params ? { paramCount: entry.params } : {}),
  };
  return { model, file };
}

/** Whether a catalog model loads on a phone with `ramGB` of RAM, by the shared fit rule: what the
 *  phone downloads (weights plus projector) against the phone budget, the same measure the picks
 *  use. Undefined when the catalog has no size for it. */
export function loadsOnPhone(id: string, ramGB: number, catalog: readonly ModelEntry[] = phoneCatalog()): boolean | undefined {
  const entry = catalog.find(candidate => candidate.id === id);
  const download = entry ? catalogEntryToDownload(entry) : null;
  if (!download) return undefined;
  const bytes = download.file.size + (download.file.mmProjFile?.size ?? 0);
  return isLoadableOnDevice(bytes / 1e9, ramGB, textModelBudget());
}

/** Fast, Balanced and Best among any kind of model (chat, image, speech) by the shared rule with the
 *  phone budget, in that order; empty slots are left out. */
export function picksAmong<T>(
  items: readonly T[],
  describe: (item: T) => PickCandidate,
  ramGB: number,
  budget: FitBudget = PHONE_FIT_BUDGET,
): { slot: PickSlot; item: T }[] {
  const byId = new Map(items.map(item => [describe(item).id, item]));
  const picks = pickModelsForDevice(items.map(describe), ramGB, budget, 'runsWell', engineLlamaBuild() ?? 0);
  return (['fast', 'balanced', 'best'] as const).flatMap(slot => {
    const item = picks[slot] ? byId.get(picks[slot]!) : undefined;
    return item ? [{ slot, item }] : [];
  });
}

/** The chat picks for a phone with `ramGB` of RAM, in Fast, Balanced, Best order. */
export function devicePicks(ramGB: number, catalog: readonly ModelEntry[] = phoneCatalog()): DevicePick[] {
  const downloads = chatEntries(catalog).flatMap(entry => {
    const download = catalogEntryToDownload(entry);
    return download ? [{ ...download, entry, sizeBytes: download.file.size + (download.file.mmProjFile?.size ?? 0) }] : [];
  });
  // The catalog's own facts drive the choice: quality ranks, active parameters set the speed, and
  // replaced, research-only or too-new models are never picked. Picks come from makers people know.
  return picksAmong(downloads, d => ({
    id: d.model.id,
    sizeBytes: d.sizeBytes,
    params: d.model.paramCount,
    org: d.entry.org,
    quality: d.entry.quality,
    activeParams: d.entry.activeParams,
    supersededBy: d.entry.supersededBy,
    nonCommercial: d.entry.nonCommercial,
    minLlamaBuild: d.entry.minLlamaBuild,
  }), ramGB, textModelBudget())
    .map(({ slot, item }) => ({ slot, ...item }));
}
