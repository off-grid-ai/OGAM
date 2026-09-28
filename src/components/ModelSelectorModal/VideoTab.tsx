import { RemoteModelOptionsSection } from '../models/RemoteModelOptionsSection';
import { remoteServerManager } from '../../services/remoteServerManager';
import React from 'react';
import { Text } from 'react-native';
import { useAppStore } from '../../stores';
import { ModelCard } from '../ModelCard';
import { Button } from '../Button';
import { useTheme } from '../../theme';
import { videoGenerationService } from '../../services/videoGenerationService';
export function VideoTab({ onSelect }: { onSelect: () => void }) {
  const models = useAppStore(s => s.downloadedVideoModels),
    selected = useAppStore(s => s.activeVideoModelId);
  const { colors } = useTheme();
  return (
    <>
      <RemoteModelOptionsSection category="video" onSelect={onSelect} />
      {!models.length && (
        <Text style={{ color: colors.textMuted }}>
          Download a video model from Models.
        </Text>
      )}
      {models.map(model => (
        <ModelCard
          key={model.id}
          compact
          model={{ id: model.id, name: model.name, author: model.org ?? '' }}
          isDownloaded
          isActive={selected === model.id}
          facts={['Video', 'Loads when generation starts']}
          disabled={videoGenerationService.getState().phase === 'running'}
          onSelect={() => {
            remoteServerManager.clearActiveRemoteMediaModel('video');
            useAppStore.getState().setActiveVideoModelId(model.id);
            onSelect();
          }}
        />
      ))}
      {selected && (
        <Button
          title="Clear video selection"
          variant="ghost"
          onPress={() => useAppStore.getState().setActiveVideoModelId(null)}
        />
      )}
    </>
  );
}
