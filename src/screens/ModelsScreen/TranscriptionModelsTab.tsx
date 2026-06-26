/**
 * TranscriptionModelsTab
 *
 * The "Transcription Models" tab on the Models screen: on-device speech-to-text
 * (Whisper) models. Shows the built-in ggml catalogue (English + multilingual),
 * rendered with the shared ModelCard so it matches the Text, Image, and Voice
 * tabs.
 *
 * Whisper is a core feature, so this tab is always available (no pro gating).
 * The whisper store tracks a single active model; downloading another switches
 * the active one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useWhisperStore } from '../../stores';
import { WHISPER_MODELS } from '../../services';
import { createStyles as createModelsScreenStyles } from './styles';
import logger from '../../utils/logger';

const ENGLISH_MODELS = WHISPER_MODELS.filter(m => m.lang === 'en');
const MULTI_MODELS = WHISPER_MODELS.filter(m => m.lang === 'multi');

const formatSize = (mb: number): string => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

interface WhisperCardProps {
  model: typeof WHISPER_MODELS[number];
  index: number;
  downloadedModelId: string | null;
  presentModelIds: string[];
  downloadingId: string | null;
  downloadProgress: number;
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const WhisperCard: React.FC<WhisperCardProps> = ({
  model, index, downloadedModelId, presentModelIds, downloadingId, downloadProgress, onDownload, onSelect, onDelete,
}) => {
  const present = presentModelIds.includes(model.id);
  const active = downloadedModelId === model.id;
  const downloading = downloadingId === model.id;
  return (
    <ModelCard
      compact
      model={{ id: model.id, name: model.name, author: formatSize(model.size), description: model.description }}
      isDownloaded={present && !downloading}
      isActive={active}
      isDownloading={downloading}
      downloadProgress={downloadProgress}
      testID={`transcription-model-card-${index}`}
      // Present but not active → tap to use; not present → tap to download.
      onPress={downloading ? undefined : (present ? (active ? undefined : () => onSelect(model.id)) : () => onDownload(model.id))}
      onDownload={!present && !downloading ? () => onDownload(model.id) : undefined}
      onDelete={present ? () => onDelete(model.id) : undefined}
    />
  );
};

export const TranscriptionModelsTab: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Reuse the Models screen's shared banner styling so it matches the other tabs.
  const shared = useThemedStyles(createModelsScreenStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const {
    downloadedModelId, presentModelIds, downloadProgress, downloadingId, downloadModel,
    selectModel, deleteModelById, refreshPresentModels, error: whisperError, clearError,
  } = useWhisperStore();

  // Probe disk on mount and whenever a download finishes, so every on-disk model
  // (not just the active one) shows as downloaded.
  useEffect(() => {
    if (!downloadingId) refreshPresentModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadingId]);

  // Re-derive from disk whenever the Models screen regains focus (e.g. returning
  // from the Download Manager after a download or delete). Disk is the source of
  // truth, so this keeps the list in sync without any cross-screen wiring.
  useFocusEffect(
    useCallback(() => {
      if (!downloadingId) refreshPresentModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [downloadingId]),
  );

  const handleDownload = useCallback((id: string) => {
    // The store owns downloadingId (set/cleared in downloadModel), so a download
    // started here — or from the chat voice button — shows progress on this tab.
    downloadModel(id).catch(err => logger.error('[Transcription] download failed:', err));
  }, [downloadModel]);

  const handleSelect = useCallback((id: string) => {
    selectModel(id).catch(err => logger.error('[Transcription] select failed:', err));
  }, [selectModel]);

  const handleDelete = useCallback((id: string) => {
    setAlertState(showAlert('Remove Transcription Model', 'This deletes the model files for this language/size.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { setAlertState(hideAlert()); deleteModelById(id); } },
    ]));
  }, [deleteModelById]);

  const renderWhisperCard = (model: typeof WHISPER_MODELS[number], index: number) => (
    <WhisperCard
      key={model.id}
      model={model}
      index={index}
      downloadedModelId={downloadedModelId}
      presentModelIds={presentModelIds}
      downloadingId={downloadingId}
      downloadProgress={downloadProgress}
      onDownload={handleDownload}
      onSelect={handleSelect}
      onDelete={handleDelete}
    />
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={shared.deviceBanner}>
        <Icon name="shield" size={11} color={colors.trending} />
        <Text style={shared.deviceBannerText}>Transcription runs on your phone, audio is never sent anywhere</Text>
      </View>

      {whisperError && (
        <TouchableOpacity onPress={clearError}>
          <Text style={styles.error}>{whisperError} (tap to dismiss)</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>English only</Text>
      {ENGLISH_MODELS.map((m, i) => renderWhisperCard(m, i))}

      <Text style={styles.sectionLabel}>Multilingual - 99 languages</Text>
      {MULTI_MODELS.map((m, i) => renderWhisperCard(m, ENGLISH_MODELS.length + i))}

      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())} />
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) =>
  ({
    flex: { flex: 1 },
    content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.xxl },
    sectionLabel: {
      ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
      letterSpacing: 0.3, marginBottom: SPACING.sm, marginTop: SPACING.xs,
    },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, textAlign: 'center' as const, marginBottom: SPACING.md },
  });
