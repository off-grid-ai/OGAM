import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { devicePicks, type DevicePick } from '../../services/devicePicks';
import { startModelDownload } from '../../services/startModelDownload';
import { activeModelService } from '../../services/activeModelService';
import type { RootStackParamList } from '../../navigation/types';
import { PicksRow, type PickItem, type PickState } from './PicksRow';

/** The chat picks: the shared catalog and picking rule; a finished pick becomes the active chat
 *  model and offers "Chat now". */
export const DevicePicksRow: React.FC<{ ramGB: number }> = ({ ramGB }) => {
  const picks = useMemo(() => devicePicks(ramGB), [ramGB]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const activeModelId = useAppStore(s => s.activeModelId);
  const downloads = useDownloadStore(s => s.downloads);

  const stateFor = (pick: DevicePick): PickState => {
    // A file name is unique in the models folder: the stable key for "is this pick downloaded".
    const downloaded = downloadedModels.find(m => m.fileName === pick.file.name);
    if (downloaded && activeModelId === downloaded.id) {
      return { kind: 'active', next: { label: 'Chat now', onPress: () => navigation.navigate('Chat', {}) } };
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
