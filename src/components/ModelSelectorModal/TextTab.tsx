import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { DownloadedModel, RemoteModel } from '../../types';
import { hardwareService } from '../../services';
import { textOverheadMultiplier } from '../../services/activeModelService/types';
import { useAppStore } from '../../stores';
import { ModelRow } from '../ModelRow';
import { createAllStyles } from './styles';

export interface TextTabProps {
  downloadedModels: DownloadedModel[];
  remoteModels: Array<{ serverId: string; serverName: string; models: RemoteModel[] }>;
  currentModelPath: string | null;
  /** The SELECTED model's path (may differ from loaded under deferred loading). */
  selectedModelPath?: string | null;
  currentRemoteModelId: string | null;
  isAnyLoading: boolean;
  /** Id of the model being loaded right now (the row just tapped) — drives the per-row spinner. */
  loadingModelId?: string | null;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectRemoteModel: (model: RemoteModel, serverId: string) => void;
  onUnloadModel: () => void;
  onAddServer: () => void;
  onBrowseModels?: () => void;
}

export const TextTab: React.FC<TextTabProps> = ({
  downloadedModels, remoteModels, currentModelPath, selectedModelPath = null, currentRemoteModelId, isAnyLoading, loadingModelId = null, onSelectModel, onUnloadModel, onSelectRemoteModel, onAddServer, onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  // RAM label uses the SAME backend-aware overhead owner (textOverheadMultiplier) that
  // activeModelService uses to register the resident's sizeMB, so this label and the residency
  // chip on the manager sheet agree for the identical loaded model (they diverged: fixed 1.5×
  // here vs 2.2× on a GPU/NPU backend there — device 2026-07-14).
  const ramMultiplier = textOverheadMultiplier(useAppStore(s => s.settings?.inferenceBackend));
  // "Loaded" drives the Currently-Loaded + Unload section (only meaningful once a model
  // is actually in memory). "Active" also counts the selected-but-not-yet-loaded model
  // so the switcher reads "Switch Model" and highlights the active choice under deferred
  // loading, instead of looking like a fresh first-pick.
  const hasLoaded = currentModelPath !== null || currentRemoteModelId !== null;
  const activeLocalPath = currentModelPath ?? selectedModelPath;
  const hasActive = activeLocalPath !== null || currentRemoteModelId !== null;
  const activeLocalModel = downloadedModels.find(m => m.filePath === currentModelPath);

  // Find active remote model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!currentRemoteModelId) return null;
    for (const group of remoteModels) {
      const model = group.models.find(m => m.id === currentRemoteModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteModels, currentRemoteModelId]);

  return (
    <>
      {hasLoaded && (
        <View style={styles.loadedSection}>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <View style={styles.loadedModelItem} testID="currently-loaded-model">
            <View style={styles.loadedModelInfo}>
              <Text style={styles.loadedModelName} numberOfLines={1} testID="currently-loaded-model-name">
                {activeLocalModel?.name || activeRemoteModelInfo?.model?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta} testID="currently-loaded-model-ram">
                {activeLocalModel
                  ? `${activeLocalModel.quantization} • ${hardwareService.formatModelSize(activeLocalModel)} • ${hardwareService.formatModelRam(activeLocalModel, ramMultiplier)} RAM`
                  : `Remote • ${activeRemoteModelInfo?.serverName ?? 'Model'}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.unloadButton} onPress={onUnloadModel} disabled={isAnyLoading}>
              <Icon name="power" size={16} color={colors.error} />
              <Text style={styles.unloadButtonText}>Unload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{hasActive ? 'Switch Model' : 'Available Models'}</Text>

      {/* Empty state when no models at all */}
      {downloadedModels.length === 0 && remoteModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="package" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Text Models</Text>
          <Text style={styles.emptyText}>Download models from the Models tab</Text>
          <View style={localStyles.emptyActions}>
            <TouchableOpacity style={[localStyles.actionButton, { borderColor: colors.border }]} onPress={onAddServer} disabled={isAnyLoading}>
              <Icon name="wifi" size={14} color={colors.textSecondary} />
              <Text style={[localStyles.actionButtonText, { color: colors.textSecondary }]}>Add Remote Server</Text>
            </TouchableOpacity>
            {onBrowseModels && (
              <TouchableOpacity style={[localStyles.actionButton, { borderColor: colors.primary }]} onPress={onBrowseModels}>
                <Icon name="download" size={14} color={colors.primary} />
                <Text style={[localStyles.actionButtonText, { color: colors.primary }]}>Browse Models</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Local Models Section */}
      {downloadedModels.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="hard-drive" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Local Models</Text>
          </View>
          {downloadedModels.map((model) => {
            const isLoaded = currentModelPath === model.filePath;
            // The selected-but-not-loaded model is highlighted as active, but stays
            // tappable so tapping it actually loads it (load-on-tap).
            // Don't highlight a deferred-local selection while a remote model is
            // current — otherwise both rows render active after a local→remote switch.
            const isSelected = currentRemoteModelId === null && !currentModelPath && selectedModelPath === model.filePath;
            // While a load is in flight, the highlight + spinner + (suppressed) checkmark all follow the
            // row being loaded — not the model that's still resident. So tapping B moves the selection to
            // B immediately, instead of leaving A highlighted until the load finishes (device 2026-07-14).
            const isLoadingThis = loadingModelId === model.id;
            const loadInProgress = loadingModelId != null;
            const isActive = loadInProgress ? isLoadingThis : (isLoaded || isSelected);
            return (
              <ModelRow
                key={model.id}
                testID={`text-model-row-${model.id}`}
                name={model.name}
                size={hardwareService.formatModelSize(model)}
                quant={model.quantization}
                isVision={model.engine === 'llama' && model.isVisionModel}
                isActive={isActive}
                isLoaded={isLoaded && !loadInProgress}
                loading={isLoadingThis}
                disabled={isAnyLoading || isLoaded}
                onPress={() => onSelectModel(model)}
              />
            );
          })}
        </>
      )}

      {/* Remote Models Sections */}
      {remoteModels.map(({ serverId, serverName, models }) => (
        <View key={serverId}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="wifi" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>{serverName}</Text>
          </View>
          {models.map((model) => {
            const isCurrent = currentRemoteModelId === model.id;
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelItem, isCurrent && styles.modelItemSelectedRemote]}
                onPress={() => onSelectRemoteModel(model, serverId)}
                disabled={isAnyLoading || isCurrent}
              >
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, isCurrent && styles.modelNameSelectedRemote]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  <View style={styles.modelMeta}>
                    <Text style={styles.remoteBadge}>Remote</Text>
                    {model.capabilities.supportsVision && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <View style={styles.visionBadge}>
                          <Icon name="eye" size={10} color={colors.info} />
                          <Text style={styles.visionBadgeText}>Vision</Text>
                        </View>
                      </>
                    )}
                    {model.capabilities.supportsToolCalling && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <View style={styles.toolBadge}>
                          <Icon name="tool" size={10} color={colors.warning} />
                        </View>
                      </>
                    )}
                    {model.capabilities.supportsThinking && (
                      <>
                        <Text style={styles.metaSeparator}>•</Text>
                        <View style={styles.thinkingBadge}>
                          <Icon name="zap" size={10} color="#8B5CF6" />
                          <Text style={styles.thinkingBadgeText}>Thinking</Text>
                        </View>
                      </>
                    )}
                  </View>
                </View>
                {isCurrent && (
                  <View style={styles.checkmarkRemote}>
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
  emptyActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
  },
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
