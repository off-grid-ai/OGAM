import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../../components/AppSheet';
import { consumePendingSpotlight } from '../../../components/onboarding/spotlightState';
import { MODEL_PICKER_STEP_INDEX } from '../../../components/onboarding/spotlightConfig';
import { Button, ModelRow } from '../../../components';
import { useTheme, useThemedStyles } from '../../../theme';
import { createStyles } from '../styles';
import { hardwareService, ResourceUsage } from '../../../services';
import { getMmProjFileSize } from '../../../utils/modelHelpers';
import { DownloadedModel, ONNXImageModel, RemoteModel } from '../../../types';
import { ModelPickerType, LoadingState } from '../hooks/useHomeScreen';
import { useRemoteServerStore } from '../../../stores';

type Props = {
  pickerType: ModelPickerType;
  loadingState: LoadingState;
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
  activeModelId: string | null;
  activeImageModelId: string | null;
  memoryInfo: ResourceUsage | null;
  remoteTextModels: RemoteModel[];
  remoteImageModels: RemoteModel[];
  activeRemoteTextModelId: string | null;
  activeRemoteImageModelId: string | null;
  onClose: () => void;
  onSelectTextModel: (model: DownloadedModel) => void;
  onUnloadTextModel: () => void;
  onSelectImageModel: (model: ONNXImageModel) => void;
  onUnloadImageModel: () => void;
  onSelectRemoteTextModel: (model: RemoteModel) => void;
  onUnloadRemoteTextModel: () => void;
  onSelectRemoteImageModel: (model: RemoteModel) => void;
  onUnloadRemoteImageModel: () => void;
  onBrowseModels: (tab: 'text' | 'image') => void;
  onAddServer?: () => void;
};

type ImageTabColors = ReturnType<typeof useTheme>['colors'];
type ImageTabStyles = ReturnType<typeof createStyles>;
type ImageTabProps = Pick<Props, 'downloadedImageModels' | 'activeImageModelId' | 'memoryInfo' | 'loadingState' | 'onUnloadImageModel' | 'onSelectImageModel' | 'onBrowseModels'> & { colors: ImageTabColors; styles: ImageTabStyles };

const ImageTabContent: React.FC<ImageTabProps> = ({ downloadedImageModels, activeImageModelId, memoryInfo, loadingState, onUnloadImageModel, onSelectImageModel, onBrowseModels, colors, styles }) => {
  if (downloadedImageModels.length === 0) {
    return (
      <View style={styles.emptyPicker}>
        <Text style={styles.emptyPickerText}>No image models available</Text>
        <Button title="Browse Models" variant="outline" size="small" onPress={() => onBrowseModels('image')} />
      </View>
    );
  }
  return (
    <>
      {activeImageModelId && (
        <TouchableOpacity style={[styles.unloadButton, localStyles.unloadButtonMargin]} onPress={onUnloadImageModel} disabled={loadingState.isLoading}>
          <Icon name="power" size={16} color={colors.error} />
          <Text style={styles.unloadButtonText}>Unload current model</Text>
        </TouchableOpacity>
      )}
      {downloadedImageModels.map((model) => {
        const estimatedMemoryGB = (model.size * 1.8) / (1024 * 1024 * 1024);
        const memoryFits = memoryInfo ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5 : true;
        return (
          <ModelRow
            key={model.id}
            testID="model-item"
            name={model.name}
            size={hardwareService.formatBytes(model.size)}
            quant={model.style || 'Image'}
            ramHint={`~${estimatedMemoryGB.toFixed(1)} GB RAM${memoryFits ? '' : ' (may not fit)'}`}
            isActive={activeImageModelId === model.id}
            isLoaded={activeImageModelId === model.id}
            variant="image"
            onPress={() => onSelectImageModel(model)}
            disabled={loadingState.isLoading}
          />
        );
      })}
    </>
  );
};

export const ModelPickerSheet: React.FC<Props> = ({
  pickerType,
  loadingState,
  downloadedModels,
  downloadedImageModels,
  activeModelId,
  activeImageModelId,
  memoryInfo,
  remoteTextModels,
  remoteImageModels: _remoteImageModels,
  activeRemoteTextModelId,
  activeRemoteImageModelId: _activeRemoteImageModelId,
  onClose,
  onSelectTextModel,
  onUnloadTextModel,
  onSelectImageModel,
  onUnloadImageModel,
  onSelectRemoteTextModel,
  onUnloadRemoteTextModel,
  onSelectRemoteImageModel: _onSelectRemoteImageModel,
  onUnloadRemoteImageModel: _onUnloadRemoteImageModel,
  onBrowseModels,
  onAddServer,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [highlightFirst, setHighlightFirst] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(0)).current;

  const servers = useRemoteServerStore((s) => s.servers);
  const activeServerId = useRemoteServerStore((s) => s.activeServerId);
  const remoteModelGroups = useMemo(() => {
    const groups: Record<string, { serverId: string; serverName: string; models: RemoteModel[] }> = {};
    for (const model of remoteTextModels) {
      if (!groups[model.serverId]) {
        const server = servers.find((s) => s.id === model.serverId);
        groups[model.serverId] = { serverId: model.serverId, serverName: server?.name || 'Remote Server', models: [] };
      }
      groups[model.serverId].models.push(model);
    }
    return Object.values(groups);
  }, [remoteTextModels, servers]);

  // NOTE: Can't use AttachStep/spotlight-tour inside Modal (separate view hierarchy).
  // Pulse the first model's border as a visual hint instead.
  useEffect(() => {
    if (pickerType === 'text') {
      const pending = consumePendingSpotlight();
      if (pending === MODEL_PICKER_STEP_INDEX) {
        setHighlightFirst(true);
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
            Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
          ]),
          { iterations: 3 },
        ).start(() => setHighlightFirst(false));
      }
    } else {
      setHighlightFirst(false);
    }
  }, [pickerType, pulseAnim]);

  const highlightBorderColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  return (
    <AppSheet
      visible={pickerType !== null}
      onClose={onClose}
      title={pickerType === 'text' ? 'Text Models' : 'Image Models'}
      snapPoints={['70%']}
    >
      <ScrollView style={styles.modalScroll} contentContainerStyle={localStyles.scrollContent}>
        {pickerType === 'text' && (
          <>
            {downloadedModels.length === 0 && remoteTextModels.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.emptyPickerText}>No text models available</Text>
                <View style={localStyles.emptyActions}>
                  <Button title="Add Remote Server" variant="outline" size="small" onPress={() => { onClose(); onAddServer?.(); }} />
                  <Button title="Browse Models" variant="outline" size="small" onPress={() => onBrowseModels('text')} />
                </View>
              </View>
            ) : (
              <>
                <View style={localStyles.actionRow}>
                  {(activeModelId || activeRemoteTextModelId) ? (
                    <TouchableOpacity
                      testID="unload-text-model-button"
                      style={[styles.unloadButton, localStyles.actionRowButton, localStyles.iconOnlyButton]}
                      onPress={activeRemoteTextModelId ? onUnloadRemoteTextModel : onUnloadTextModel}
                      disabled={loadingState.isLoading}
                    >
                      <Icon name="power" size={16} color={colors.error} />
                    </TouchableOpacity>
                  ) : (
                    <View style={localStyles.iconOnlyButton} />
                  )}
                  <TouchableOpacity
                    testID="add-server-button"
                    style={[styles.unloadButton, localStyles.actionRowButton, localStyles.addServerButton]}
                    onPress={() => { onClose(); onAddServer?.(); }}
                  >
                    <Icon name="plus" size={16} color={colors.primary} />
                    <Text style={[styles.unloadButtonText, { color: colors.primary }]}>Add Remote Server</Text>
                  </TouchableOpacity>
                </View>

                {downloadedModels.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Local Models</Text>
                    {downloadedModels.map((model, idx) => {
                      const totalSize = model.fileSize + getMmProjFileSize(model);
                      const estimatedMemoryGB = (totalSize * 1.5) / (1024 * 1024 * 1024);
                      const memoryFits = memoryInfo
                        ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                        : true;
                      const isHighlighted = idx === 0 && highlightFirst;
                      const modelItem = (
                        <ModelRow
                          testID="model-item"
                          name={model.name}
                          size={hardwareService.formatModelSize(model)}
                          quant={model.quantization}
                          isVision={model.engine === 'llama' && model.isVisionModel}
                          ramHint={`~${estimatedMemoryGB.toFixed(1)} GB RAM${memoryFits ? '' : ' (may not fit)'}`}
                          isActive={activeModelId === model.id}
                          isLoaded={activeModelId === model.id}
                          onPress={() => onSelectTextModel(model)}
                          disabled={loadingState.isLoading}
                        />
                      );
                      if (isHighlighted) {
                        return (
                          <Animated.View key={model.id} style={[localStyles.highlightBorder, { borderColor: highlightBorderColor }]}>
                            {modelItem}
                            <Text style={[localStyles.highlightHint, { color: colors.textSecondary }]}>
                              Tap this model to load it for chatting
                            </Text>
                          </Animated.View>
                        );
                      }
                      return <View key={model.id}>{modelItem}</View>;
                    })}
                  </>
                )}

                {remoteModelGroups.map(({ serverId, serverName, models }) => (
                  <View key={serverId}>
                    <View style={localStyles.serverHeaderRow}>
                      <Icon name="wifi" size={14} color={colors.textMuted} />
                      <Text style={styles.sectionLabel}>{serverName}</Text>
                    </View>
                    {models.map((model) => (
                      <TouchableOpacity
                        key={`${model.serverId}-${model.id}`}
                        testID="remote-model-item"
                        style={[styles.pickerItem, activeRemoteTextModelId === model.id && styles.pickerItemActive]}
                        onPress={() => onSelectRemoteTextModel(model)}
                        disabled={loadingState.isLoading}
                      >
                        <View style={styles.pickerItemInfo}>
                          <Text style={styles.pickerItemName}>
                            {model.name}{' '}
                            <Icon name="cloud" size={14} color={colors.primary} />
                          </Text>
                          <Text style={styles.pickerItemMeta}>
                            {[model.capabilities.supportsVision && 'Vision', model.capabilities.supportsToolCalling && 'Tools', model.capabilities.supportsThinking && 'Thinking'].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        {activeRemoteTextModelId === model.id && activeServerId === model.serverId && (
                          <Icon name="check" size={18} color={colors.text} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {pickerType === 'image' && (
          <ImageTabContent
            downloadedImageModels={downloadedImageModels}
            activeImageModelId={activeImageModelId}
            memoryInfo={memoryInfo}
            loadingState={loadingState}
            onUnloadImageModel={onUnloadImageModel}
            onSelectImageModel={onSelectImageModel}
            onBrowseModels={onBrowseModels}
            colors={colors}
            styles={styles}
          />
        )}
      </ScrollView>

      <TouchableOpacity style={styles.browseMoreButton} onPress={() => onBrowseModels(pickerType ?? 'text')}>
        <Text style={styles.browseMoreText}>Browse more models</Text>
        <Icon name="arrow-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </AppSheet>
  );
};

const TRANSPARENT = 'transparent' as const;

const localStyles = StyleSheet.create({
  highlightBorder: { borderWidth: 2, borderRadius: 10 },
  highlightHint: { fontSize: 11, fontStyle: 'italic', paddingHorizontal: 12, paddingBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  actionRowButton: { flex: 1 },
  iconOnlyButton: { flex: 1 },
  addServerButton: { borderColor: TRANSPARENT },
  unloadButtonMargin: { marginBottom: 12 },
  emptyActions: { flexDirection: 'row' as const, gap: 10 },
  scrollContent: { paddingBottom: 16 },
  serverHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 },
});
