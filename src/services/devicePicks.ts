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

/** The picks for a phone with `ramGB` of RAM, in Fast, Balanced, Best order; empty slots are left out. */
export function devicePicks(ramGB: number): DevicePick[] {
  const downloads = new Map<string, { model: ModelInfo; file: ModelFile; sizeBytes: number }>();
  for (const entry of chatEntries()) {
    const download = catalogEntryToDownload(entry);
    if (!download) continue;
    downloads.set(entry.id, { ...download, sizeBytes: download.file.size + (download.file.mmProjFile?.size ?? 0) });
  }
  const picks = pickModelsForDevice(
    [...downloads].map(([id, d]) => ({ id, sizeBytes: d.sizeBytes, params: d.model.paramCount })),
    ramGB,
    PHONE_FIT_BUDGET,
    'runsWell',
  );
  return (['fast', 'balanced', 'best'] as const).flatMap(slot => {
    const id = picks[slot];
    const download = id ? downloads.get(id) : undefined;
    return download ? [{ slot, ...download }] : [];
  });
}
