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
export const ImagePicksRow: React.FC<{
  models: HFImageModel[];
  ramGB: number;
  onDownload: (descriptor: ImageModelDescriptor) => void;
}> = ({ models, ramGB, onDownload }) => {
  const picks = useMemo(
    () => picksAmong(models, model => ({ id: model.id, sizeBytes: model.size }), ramGB),
    [models, ramGB],
  );
  const downloaded = useAppStore(s => s.downloadedImageModels);
  const activeId = useAppStore(s => s.activeImageModelId);
  const setActive = useAppStore(s => s.setActiveImageModelId);
  const downloads = useDownloadStore(s => s.downloads);

  const stateFor = (model: HFImageModel): PickState => {
    if (downloaded.some(d => d.id === model.id)) {
      return activeId === model.id ? { kind: 'active' } : { kind: 'use', onUse: () => setActive(model.id) };
    }
    const entry = downloads[makeImageModelKey(model.id)];
    if (entry && isActiveStatus(entry.status)) return { kind: 'downloading', progress: entry.progress ?? 0 };
    return { kind: 'download', onDownload: () => onDownload(hfModelToDescriptor(model)) };
  };

  const items: PickItem[] = picks.map(({ slot, item }) => ({ slot, name: item.displayName, sizeBytes: item.size, state: stateFor(item) }));
  return <PicksRow items={items} testID="image-picks" />;
};
