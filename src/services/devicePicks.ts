import { CATALOG, pickModelsForDevice, PHONE_FIT_BUDGET, type ModelEntry } from '@offgrid/models';
import type { ModelFile, ModelInfo } from '../types';

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

/** The chat models a phone can download from the catalog: ready, chat or vision, one entry per
 *  model (quantization variants are options of their base model, not separate picks). */
function chatEntries(): ModelEntry[] {
  return CATALOG.filter(entry =>
    (entry.kind === 'text' || entry.kind === 'vision') &&
    entry.availability !== 'coming_soon' &&
    !entry.grounder &&
    !entry.quantOf &&
    entry.files.some(file => file.role === 'primary' || file.role === undefined),
  );
}

/** A catalog entry as the phone's download request: the primary weights plus the projector. */
export function catalogEntryToDownload(entry: ModelEntry): { model: ModelInfo; file: ModelFile } | null {
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

/** Fast, Balanced and Best among any kind of model (chat, image, speech) by the shared rule with the
 *  phone budget, in that order; empty slots are left out. */
export function picksAmong<T>(
  items: readonly T[],
  describe: (item: T) => { id: string; sizeBytes: number; params?: number },
  ramGB: number,
): { slot: PickSlot; item: T }[] {
  const byId = new Map(items.map(item => [describe(item).id, item]));
  const picks = pickModelsForDevice(items.map(describe), ramGB, PHONE_FIT_BUDGET, 'runsWell');
  return (['fast', 'balanced', 'best'] as const).flatMap(slot => {
    const item = picks[slot] ? byId.get(picks[slot]!) : undefined;
    return item ? [{ slot, item }] : [];
  });
}

/** The chat picks for a phone with `ramGB` of RAM, in Fast, Balanced, Best order. */
export function devicePicks(ramGB: number): DevicePick[] {
  const downloads = chatEntries().flatMap(entry => {
    const download = catalogEntryToDownload(entry);
    return download ? [{ ...download, sizeBytes: download.file.size + (download.file.mmProjFile?.size ?? 0) }] : [];
  });
  return picksAmong(downloads, d => ({ id: d.model.id, sizeBytes: d.sizeBytes, params: d.model.paramCount }), ramGB)
    .map(({ slot, item }) => ({ slot, ...item }));
}

/** Catalog models whose name, maker or description matches a search, as list entries. Search shows
 *  these first, then Hugging Face results. */
export function catalogMatches(query: string): ModelInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return chatEntries()
    .filter(entry => [entry.name, entry.id, entry.org ?? '', entry.description ?? ''].some(text => text.toLowerCase().includes(needle)))
    .flatMap(entry => {
      const download = catalogEntryToDownload(entry);
      return download ? [download.model] : [];
    });
}
