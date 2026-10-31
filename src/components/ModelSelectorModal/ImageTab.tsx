import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import { LoadingDots } from '../LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ONNXImageModel, RemoteModel } from '../../types';
import { hardwareService } from '../../services';
import { ModelCard } from '../ModelCard';
import { RemoteModelServerGroup } from '../models/RemoteModelServerGroup';
import { fileExceedsBudget } from '../../services/memoryBudget';
import { createAllStyles } from './styles';

export interface ImageTabProps {
  downloadedImageModels: ONNXImageModel[];
  remoteVisionModels: Array<{
    serverId: string;
    serverName: string;
    models: RemoteModel[];
  }>;
  activeImageModelId: string | null;
  loadedImageModelId: string | null;
  activeRemoteImageModelId: string | null;
  activeRemoteImageServerId: string | null;
  isAnyLoading: boolean;
  isLoadingImage: boolean;
  /** Server and model key for the remote row being selected. */
  loadingRemoteModelKey?: string | null;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onSelectRemoteVisionModel: (model: RemoteModel, serverId: string) => void;
  onUnloadImageModel: () => void;
  onBrowseModels?: () => void;
}

export const ImageTab: React.FC<ImageTabProps> = ({
  downloadedImageModels,
  remoteVisionModels,
  activeImageModelId,
  loadedImageModelId,
  activeRemoteImageModelId,
  activeRemoteImageServerId,
  isAnyLoading,
  isLoadingImage,
  loadingRemoteModelKey = null,
  onSelectImageModel,
  onUnloadImageModel,
  onSelectRemoteVisionModel,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const hasRemoteSelection = !!activeRemoteImageModelId && !!activeRemoteImageServerId;
  const hasSelection = !!activeImageModelId || !!activeRemoteImageModelId;
  const isCurrentLoaded = !hasRemoteSelection && loadedImageModelId === activeImageModelId;
  const activeModel = hasRemoteSelection
    ? undefined
    : downloadedImageModels.find(m => m.id === activeImageModelId);

  // Find active remote vision model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!activeRemoteImageModelId) return null;
    for (const group of remoteVisionModels) {
      if (group.serverId !== activeRemoteImageServerId) continue;
      const model = group.models.find(m => m.id === activeRemoteImageModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteVisionModels, activeRemoteImageModelId, activeRemoteImageServerId]);

  return (
    <>
      {hasSelection && (
        <View>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>{isCurrentLoaded ? 'Currently Loaded' : 'Selected Model'}</Text>
          </View>
          <ModelCard
            compact
            testID="currently-loaded-image-model"
            nameTestID="currently-loaded-image-model-name"
            factsTestID="currently-loaded-image-model-ram"
            model={{ id: activeModel?.id ?? activeRemoteModelInfo?.model.id ?? 'selected-image',
              name: activeModel?.name ?? activeRemoteModelInfo?.model.name ?? 'Unknown',
              author: activeRemoteModelInfo?.serverName ?? 'On device', modelType: 'vision' }}
            file={activeModel ? { name: activeModel.name, size: activeModel.size, quantization: '', downloadUrl: '' } : undefined}
            sourceBadge={activeRemoteModelInfo ? 'Remote' : undefined}
            facts={activeModel ? [activeModel.style || 'Image',
              `${hardwareService.formatBytes(hardwareService.estimateImageModelRam(activeModel))} RAM`] : []}
            isActive
            trailing={<TouchableOpacity style={styles.unloadButton} onPress={onUnloadImageModel} disabled={isAnyLoading}>
              {isLoadingImage ? <LoadingDots color={colors.error} /> : <>
                <Icon name="power" size={16} color={colors.error} />
                <Text style={styles.unloadButtonText}>{isCurrentLoaded ? 'Unload' : 'Deselect'}</Text>
              </>}
            </TouchableOpacity>}
          />
        </View>
      )}

      <Text style={styles.sectionTitle}>
        {hasSelection ? 'Switch Model' : 'Available Models'}
      </Text>

      {/* Local Image Models */}
      {downloadedImageModels.length === 0 &&
        remoteVisionModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="image" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Image Models</Text>
            <Text style={styles.emptyText}>
              Download image models from the Models tab
            </Text>
          {onBrowseModels && (
              <TouchableOpacity
                style={[
                  localStyles.actionButton,
                  { borderColor: colors.primary },
                ]}
                onPress={onBrowseModels}
              >
              <Icon name="download" size={14} color={colors.primary} />
                <Text
                  style={[
                    localStyles.actionButtonText,
                    { color: colors.primary },
                  ]}
                >
                  Browse Models
                </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {downloadedImageModels.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="hard-drive" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Local Models</Text>
          </View>
          {downloadedImageModels.map(model => {
            const estimatedMemory = hardwareService.estimateImageModelRam(model);
            const memoryFits = !fileExceedsBudget(model.size, hardwareService.getTotalMemoryGB());
            const isCurrent = !hasRemoteSelection && activeImageModelId === model.id;
            return (
              <ModelCard
                key={model.id}
                compact
                testID={`image-model-row-${model.id}`}
                model={{ id: model.id, name: model.name, author: 'On device', modelType: 'vision' }}
                file={{ name: model.name, size: model.size, quantization: '', downloadUrl: '' }}
                facts={[
                  model.style || 'Image',
                  `~${(estimatedMemory / (1024 * 1024 * 1024)).toFixed(1)} GB RAM${memoryFits ? '' : ' (may not fit)'}`,
                ]}
                isActive={isCurrent}
                trailing={isCurrent
                  ? <View style={styles.checkmark}><Icon name="check" size={16} color={colors.background} /></View>
                  : null}
                onPress={() => onSelectImageModel(model)}
                disabled={isAnyLoading || isCurrent}
              />
            );
          })}
        </>
      )}

      {/* Remote Vision Models */}
      {remoteVisionModels.map(({ serverId, serverName, models }) => (
        <RemoteModelServerGroup
          key={serverId}
          serverName={serverName}
          disabled={isAnyLoading}
          loadingTestID="remote-image-model-loading"
          rows={models.map(model => ({
            id: model.id,
            testID: `remote-image-model-${serverId}-${model.id}`,
            model: { id: model.id, name: model.name, author: '', modelType: 'vision' },
            isCurrent: activeRemoteImageServerId === serverId && activeRemoteImageModelId === model.id,
            isLoading: loadingRemoteModelKey === `${serverId}:${model.id}`,
            onPress: () => onSelectRemoteVisionModel(model, serverId),
          }))}
        />
      ))}
    </>
  );
};

const localStyles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '400',
  },
});
