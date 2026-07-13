import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ONNXImageModel, RemoteModel } from '../../types';
import { hardwareService } from '../../services';
import { createAllStyles } from './styles';

export interface ImageTabProps {
  downloadedImageModels: ONNXImageModel[];
  remoteVisionModels: Array<{ serverId: string; serverName: string; models: RemoteModel[] }>;
  activeImageModelId: string | null;
  activeRemoteImageModelId: string | null;
  isAnyLoading: boolean;
  isLoadingImage: boolean;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onSelectRemoteVisionModel: (model: RemoteModel, serverId: string) => void;
  onUnloadImageModel: () => void;
  onBrowseModels?: () => void;
}

export const ImageTab: React.FC<ImageTabProps> = ({
  downloadedImageModels, remoteVisionModels, activeImageModelId, activeRemoteImageModelId, isAnyLoading, isLoadingImage,
  onSelectImageModel, onUnloadImageModel, onSelectRemoteVisionModel, onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const hasLoaded = !!activeImageModelId || !!activeRemoteImageModelId;
  const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);

  // Find active remote vision model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!activeRemoteImageModelId) return null;
    for (const group of remoteVisionModels) {
      const model = group.models.find(m => m.id === activeRemoteImageModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteVisionModels, activeRemoteImageModelId]);

  return (
    <>
      {hasLoaded && (
        <View style={[styles.loadedSection, styles.loadedSectionImage]}>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <View style={styles.loadedModelItem}>
            <View style={styles.loadedModelInfo}>
              <Text style={styles.loadedModelName} numberOfLines={1}>
                {activeModel?.name || activeRemoteModelInfo?.model?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeModel
                  ? `${activeModel.style || 'Image'} • ${hardwareService.formatBytes(activeModel.size ?? 0)}`
                  : `Remote • ${activeRemoteModelInfo?.serverName ?? 'Model'}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.unloadButton} onPress={onUnloadImageModel} disabled={isAnyLoading}>
              {isLoadingImage ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Icon name="power" size={16} color={colors.error} />
                  <Text style={styles.unloadButtonText}>Unload</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{hasLoaded ? 'Switch Model' : 'Available Models'}</Text>

      {/* Local Image Models */}
      {downloadedImageModels.length === 0 && remoteVisionModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="image" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Image Models</Text>
          <Text style={styles.emptyText}>Download image models from the Models tab</Text>
          {onBrowseModels && (
            <TouchableOpacity style={[localStyles.actionButton, { borderColor: colors.primary }]} onPress={onBrowseModels}>
              <Icon name="download" size={14} color={colors.primary} />
              <Text style={[localStyles.actionButtonText, { color: colors.primary }]}>Browse Models</Text>
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
          {downloadedImageModels.map((model) => {
            const isCurrent = activeImageModelId === model.id;
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelItem, isCurrent && styles.modelItemSelectedImage]}
                onPress={() => onSelectImageModel(model)}
                disabled={isAnyLoading || isCurrent}
              >
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedImage]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <View style={styles.modelMeta}>
                    <Text style={styles.modelSize}>{hardwareService.formatBytes(model.size)}</Text>
                    {!!model.style && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <Text style={styles.modelStyle}>{model.style}</Text>
                      </>
                    )}
                  </View>
                </View>
                {isCurrent && (
                  <View style={[styles.checkmark, styles.checkmarkImage]}>
                    <Icon name="check" size={16} color={colors.background} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {/* Remote Vision Models */}
      {remoteVisionModels.map(({ serverId, serverName, models }) => (
        <View key={serverId}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="wifi" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>{serverName}</Text>
          </View>
          {models.map((model) => {
            const isCurrent = activeRemoteImageModelId === model.id;
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelItem, isCurrent && styles.modelItemSelectedImage]}
                onPress={() => onSelectRemoteVisionModel(model, serverId)}
                disabled={isAnyLoading || isCurrent}
              >
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedImage]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <View style={styles.modelMeta}>
                    <Text style={styles.remoteBadge}>Remote</Text>
                    <Text style={styles.metaSeparator}>•</Text>
                    <View style={styles.visionBadge}>
                      <Icon name="eye" size={10} color={colors.info} />
                      <Text style={styles.visionBadgeText}>Vision</Text>
                    </View>
                  </View>
                </View>
                {isCurrent && (
                  <View style={[styles.checkmark, styles.checkmarkImage]}>
                    <Icon name="check" size={16} color={colors.background} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
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
