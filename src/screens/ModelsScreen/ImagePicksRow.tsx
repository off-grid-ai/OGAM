import React, { useMemo } from 'react';
import { useAppStore } from '../../stores';
import { useDownloadStore, isActiveStatus } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import { picksAmong } from '../../services/devicePicks';
import type { HFImageModel } from '../../services/huggingFaceModelBrowser';
import type { ImageModelDescriptor } from './types';
import { hfModelToDescriptor } from './utils';
import { PicksRow, type PickItem, type PickState } from '../../components/models/PicksRow';

/** The image picks: the same shared rule over the image models this phone can run. A finished pick
 *  becomes the image model chat uses. */
/** A model's family: its name without bracketed variants ("SD 2.1 Palettized (Low RAM) (Core ML)"
 *  and "SD 2.1 Palettized (Core ML)" are one model, "SD 2.1 Palettized"). */
export function imageFamilyName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)/g, '').trim();
}

/** One candidate per family: the variant this phone is recommended, else the first listed. */
function oneVariantPerFamily<T extends { displayName: string }>(models: readonly T[], isRecommended: (model: T) => boolean): T[] {
  const families = new Map<string, T>();
  for (const model of models) {
    const family = imageFamilyName(model.displayName);
    const kept = families.get(family);
    if (!kept || (!isRecommended(kept) && isRecommended(model))) families.set(family, model);
  }
  return [...families.values()];
}

/** The image picks for this phone: one variant per model, by the shared rule. */
export function imagePicks<T extends HFImageModel>(models: readonly T[], ramGB: number, isRecommended: (model: T) => boolean) {
  return picksAmong(oneVariantPerFamily(models, isRecommended), model => ({ id: model.id, sizeBytes: model.size }), ramGB);
}

export const ImagePicksRow: React.FC<{
  models: HFImageModel[];
  ramGB: number;
  isRecommended: (model: HFImageModel) => boolean;
  onDownload: (descriptor: ImageModelDescriptor) => void;
}> = ({ models, ramGB, isRecommended, onDownload }) => {
  const picks = useMemo(() => imagePicks(models, ramGB, isRecommended), [models, ramGB, isRecommended]);
  const downloaded = useAppStore(s => s.downloadedImageModels);
  const activeId = useAppStore(s => s.activeImageModelId);
  const setActive = useAppStore(s => s.setActiveImageModelId);
  const downloads = useDownloadStore(s => s.downloads);

  const stateFor = (model: HFImageModel): PickState => {
    // A pick stands for its family: any downloaded variant of it counts.
    const family = imageFamilyName(model.displayName);
    const installed = downloaded.filter(d => imageFamilyName(d.name) === family);
    if (installed.length > 0) {
      if (installed.some(d => d.id === activeId)) return { kind: 'active' };
      const first = installed[0];
      return { kind: 'use', onUse: () => setActive(first.id) };
    }
    const entry = downloads[makeImageModelKey(model.id)];
    if (entry && isActiveStatus(entry.status)) return { kind: 'downloading', progress: entry.progress ?? 0 };
    return { kind: 'download', onDownload: () => onDownload(hfModelToDescriptor(model)) };
  };

  const items: PickItem[] = picks.map(({ slot, item }) => ({ slot, name: imageFamilyName(item.displayName), sizeBytes: item.size, state: stateFor(item) }));
  return <PicksRow items={items} testID="image-picks" />;
};
