import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { DownloadedModel, RemoteModel } from '../../types';
import { hardwareService } from '../../services';
import { textOverheadMultiplier } from '../../services/activeModelService/types';
import { estimateTextModelMemoryMB } from '../../services/activeModelService/memory';
import { useAppStore } from '../../stores';
import { ModelCard } from '../ModelCard';
import { createAllStyles } from './styles';
import { fileExceedsBudget } from '../../services/memoryBudget';
import { useResidentRows } from '../models/useResidentRows';
import { predictGgufCapabilities } from '../../utils/ggufCapabilities';
import { LoadingDots } from '../LoadingDots';

export interface TextTabProps {
  downloadedModels: DownloadedModel[];
  remoteModels: Array<{
    serverId: string;
    serverName: string;
    models: RemoteModel[];
  }>;
  currentModelPath: string | null;
  /** The SELECTED model's path (may differ from loaded under deferred loading). */
  selectedModelPath?: string | null;
  currentRemoteModelId: string | null;
  isAnyLoading: boolean;
  /** Id of the model being loaded right now (the row just tapped) — drives the per-row spinner. */
  loadingModelId?: string | null;
  /** Server and model key for the remote row being selected. */
  loadingRemoteModelKey?: string | null;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectRemoteModel: (model: RemoteModel, serverId: string) => void;
  onUnloadModel: () => void;
  onAddServer: () => void;
  onBrowseModels?: () => void;
}

export const TextTab: React.FC<TextTabProps> = ({
  downloadedModels,
  remoteModels,
  currentModelPath,
  selectedModelPath = null,
  currentRemoteModelId,
  isAnyLoading,
  loadingModelId = null,
  loadingRemoteModelKey = null,
  onSelectModel,
  onUnloadModel,
  onSelectRemoteModel,
  onAddServer,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  // RAM label uses the SAME backend-aware overhead owner (textOverheadMultiplier) that
  // activeModelService uses to register the resident's sizeMB, so this label and the residency
  // chip on the manager sheet agree for the identical loaded model (they diverged: fixed 1.5×
  // here vs 2.2× on a GPU/NPU backend there — device 2026-07-14).
  const inferenceBackend = useAppStore(s => s.settings?.inferenceBackend);
  const ramMultiplier = textOverheadMultiplier(inferenceBackend);
  const [estimatedRamMB, setEstimatedRamMB] = useState<Record<string, number>>({});
  useEffect(() => {
    let current = true;
    Promise.all(downloadedModels.map(async model => [
      model.id,
      await estimateTextModelMemoryMB(model),
    ] as const)).then(estimates => {
      if (current) setEstimatedRamMB(Object.fromEntries(estimates));
    });
    return () => { current = false; };
  }, [downloadedModels, inferenceBackend]);
  const textResident = useResidentRows(true).text;
  // "Loaded" drives the Currently-Loaded + Unload section (only meaningful once a model
  // is actually in memory). "Active" also counts the selected-but-not-yet-loaded model
  // so the switcher reads "Switch Model" and highlights the active choice under deferred
  // loading, instead of looking like a fresh first-pick.
  const hasLoaded = currentModelPath !== null || currentRemoteModelId !== null;
  const activeLocalPath = currentModelPath ?? selectedModelPath;
  const hasActive = activeLocalPath !== null || currentRemoteModelId !== null;
  const activeLocalModel = downloadedModels.find(
    m => m.filePath === currentModelPath,
  );
  const activeLocalCapabilities = activeLocalModel?.engine === 'llama'
    ? predictGgufCapabilities(activeLocalModel) : null;

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
        <View>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <ModelCard
            compact
            testID="currently-loaded-model"
            nameTestID="currently-loaded-model-name"
            factsTestID="currently-loaded-model-ram"
            model={{
              id: activeLocalModel?.id ?? activeRemoteModelInfo?.model.id ?? 'selected',
              name: activeLocalModel?.name ?? activeRemoteModelInfo?.model.name ?? 'Unknown',
              author: activeLocalModel?.author ?? activeRemoteModelInfo?.serverName ?? '',
              modelType: activeRemoteModelInfo?.model.capabilities.supportsVision ? 'vision' : 'text',
              quantization: typeof activeRemoteModelInfo?.model.details?.quantization === 'string'
                ? activeRemoteModelInfo.model.details.quantization : undefined,
            }}
            downloadedModel={activeLocalModel}
            sourceBadge={activeRemoteModelInfo ? 'Remote' : undefined}
            capabilities={activeRemoteModelInfo ? {
              vision: activeRemoteModelInfo.model.capabilities.supportsVision,
              tools: activeRemoteModelInfo.model.capabilities.supportsToolCalling,
              thinking: activeRemoteModelInfo.model.capabilities.supportsThinking,
            } : { ...activeLocalCapabilities, predicted: true }}
            facts={activeLocalModel
              ? [`${textResident
                  ? `${(textResident.sizeMB / 1024).toFixed(1)} GB`
                  : hardwareService.formatModelRam(activeLocalModel, ramMultiplier)} RAM`]
              : []}
            isActive
            trailing={<TouchableOpacity style={styles.unloadButton} onPress={onUnloadModel} disabled={isAnyLoading}>
              <Icon name="power" size={16} color={colors.error} />
              <Text style={styles.unloadButtonText}>Unload</Text>
            </TouchableOpacity>}
          />
        </View>
      )}

      <Text style={styles.sectionTitle}>
        {hasActive ? 'Switch Model' : 'Available Models'}
      </Text>

      {/* Empty state when no models at all */}
      {downloadedModels.length === 0 && remoteModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="package" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Text Models</Text>
          <Text style={styles.emptyText}>
            Download models from the Models tab
          </Text>
          <View style={localStyles.emptyActions}>
            <TouchableOpacity
              style={[localStyles.actionButton, { borderColor: colors.border }]}
              onPress={onAddServer}
              disabled={isAnyLoading}
            >
              <Icon name="wifi" size={14} color={colors.textSecondary} />
              <Text
                style={[
                  localStyles.actionButtonText,
                  { color: colors.textSecondary },
                ]}
              >
                Add Remote Server
              </Text>
            </TouchableOpacity>
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
        </View>
      )}

      {/* Local Models Section */}
      {downloadedModels.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="hard-drive" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Local Models</Text>
          </View>
          {downloadedModels.map(model => {
            const fileSize = (model.fileSize || 0) + ('mmProjFileSize' in model ? (model.mmProjFileSize || 0) : 0);
            const memoryFits = !fileExceedsBudget(fileSize, hardwareService.getTotalMemoryGB());
            const isLoaded = currentModelPath === model.filePath;
            // A selected-but-not-loaded model stays highlighted. A tap confirms the
            // selection; the first chat message starts the load.
            // Don't highlight a deferred-local selection while a remote model is
            // current — otherwise both rows render active after a local→remote switch.
            const isSelected =
              currentRemoteModelId === null &&
              !currentModelPath &&
              selectedModelPath === model.filePath;
            // While a load is in flight, the highlight + spinner + (suppressed) checkmark all follow the
            // row being loaded — not the model that's still resident. So tapping B moves the selection to
            // B immediately, instead of leaving A highlighted until the load finishes (device 2026-07-14).
            const isLoadingThis = loadingModelId === model.id;
            const loadInProgress = loadingModelId != null;
            const isActive =
              currentRemoteModelId === null &&
              (loadInProgress ? isLoadingThis : isLoaded || isSelected);
            const predictedCapabilities = model.engine === 'llama' ? predictGgufCapabilities(model) : null;
            return (
              <ModelCard
                key={model.id}
                compact
                testID={`text-model-row-${model.id}`}
                model={{ id: model.id, name: model.name, author: model.author || 'On device',
                  modelType: predictedCapabilities?.vision ? 'vision' : 'text' }}
                downloadedModel={model}
                capabilities={{ ...predictedCapabilities, predicted: true }}
                facts={[`${estimatedRamMB[model.id] != null
                  ? `~${(estimatedRamMB[model.id] / 1024).toFixed(1)} GB`
                  : hardwareService.formatModelRam(model, ramMultiplier)} RAM${memoryFits ? '' : ' (may not fit)'}`]}
                isActive={isActive}
                trailing={isLoadingThis ? <LoadingDots color={colors.primary} testID="model-row-loading" />
                  : isLoaded && !loadInProgress && currentRemoteModelId === null
                    ? <View style={styles.checkmark}><Icon name="check" size={16} color={colors.background} /></View>
                    : null}
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
          {models.map(model => {
            const isCurrent = currentRemoteModelId === model.id;
            const isLoadingThis =
              loadingRemoteModelKey === `${serverId}:${model.id}`;
            return (
              <ModelCard
                key={model.id}
                compact
                testID={`remote-text-model-${serverId}-${model.id}`}
                model={{ id: model.id, name: model.name, author: '',
                  modelType: model.capabilities.supportsVision ? 'vision' : 'text',
                  quantization: typeof model.details?.quantization === 'string' ? model.details.quantization : undefined }}
                sourceBadge="Remote"
                capabilities={{
                  vision: model.capabilities.supportsVision,
                  tools: model.capabilities.supportsToolCalling,
                  thinking: model.capabilities.supportsThinking,
                }}
                isActive={isCurrent || isLoadingThis}
                onPress={() => onSelectRemoteModel(model, serverId)}
                disabled={isAnyLoading || isCurrent}
                trailing={isLoadingThis ? <LoadingDots color={colors.primary} testID="remote-text-model-loading" />
                  : isCurrent ? <View style={styles.checkmarkRemote}><Icon name="check" size={16} color={colors.background} /></View>
                  : null}
              />
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
