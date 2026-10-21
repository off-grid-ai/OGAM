import React, { useMemo } from 'react';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { CATALOG } from '@offgrid/models';
import { devicePicks, type DevicePick } from '../../services/devicePicks';
import { useWithRemoteCatalog } from '../../stores/modelCatalogStore';
import { startModelDownload } from '../../services/startModelDownload';
import { activeModelService } from '../../services/activeModelService';
import { PicksRow, type PickItem, type PickState } from './PicksRow';

/** The chat picks: the shared catalog and picking rule; a finished pick becomes the active chat
 *  model and offers "Chat now". */
export const DevicePicksRow: React.FC<{ ramGB: number; onChat: () => void }> = ({ ramGB, onChat }) => {
  const catalog = useWithRemoteCatalog('models', CATALOG);
  const picks = useMemo(() => devicePicks(ramGB, catalog), [ramGB, catalog]);
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const activeModelId = useAppStore(s => s.activeModelId);
  const downloads = useDownloadStore(s => s.downloads);

  const stateFor = (pick: DevicePick): PickState => {
    // A file name is unique in the models folder: the stable key for "is this pick downloaded".
    const downloaded = downloadedModels.find(m => m.fileName === pick.file.name);
    if (downloaded && activeModelId === downloaded.id) {
      return { kind: 'active', next: { label: 'Chat now', icon: 'message-circle', onPress: onChat } };
    }
    if (downloaded) return { kind: 'use', onUse: () => activeModelService.selectTextModel(downloaded.id) };
    const entry = downloads[makeModelKey(pick.model.id, pick.file.name)];
    if (entry && entry.status !== 'failed' && entry.status !== 'completed') {
      return { kind: 'downloading', progress: entry.progress ?? 0 };
    }
    return {
      kind: 'download',
      onDownload: () => {
        startModelDownload(pick.model.id, pick.file, {
          onRegistered: model => activeModelService.selectTextModel(model.id),
        }).catch(() => {});
      },
    };
  };

  const items: PickItem[] = picks.map(pick => ({ slot: pick.slot, name: pick.model.name, sizeBytes: pick.sizeBytes, state: stateFor(pick) }));
  return <PicksRow items={items} />;
};
