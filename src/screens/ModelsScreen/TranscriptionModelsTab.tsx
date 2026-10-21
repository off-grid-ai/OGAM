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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useWhisperStore, useAppStore } from '../../stores';
import { useSttDownloadState } from '../../hooks/useSttDownloadState';
import type { MobileWhisperCatalogModel } from '@offgrid/models';
import { WHISPER_MODELS } from '../../services';
import { useWithRemoteCatalog } from '../../stores/modelCatalogStore';
import { createStyles as createModelsScreenStyles } from './styles';
import logger from '../../utils/logger';
import { RemoteModelOptionsSection } from '../../components/models/RemoteModelOptionsSection';
import { useActiveRemoteModelLabels } from '../../hooks/useActiveRemoteModelLabels';
import { remoteServerManager } from '../../services/remoteServerManager';
import { modelDownloadService } from '../../services/modelDownloadService';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';
import { picksAmong } from '../../services/devicePicks';
import { hardwareService } from '../../services/hardware';
import { PicksRow, type PickState } from '../../components/models/PicksRow';

const formatSize = (mb: number): string =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;

interface WhisperCardProps {
  model: MobileWhisperCatalogModel;
  index: number;
  downloadedModelId: string | null;
  presentModelIds: string[];
  downloading: boolean;
  queued: boolean;
  paused: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  downloadProgress: number;
  downloadBytes?: {
    downloaded: number;
    total: number;
    bytesPerSecond?: number;
  };
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

const WhisperCard: React.FC<WhisperCardProps> = ({
  model,
  index,
  downloadedModelId,
  presentModelIds,
  downloading,
  queued,
  paused,
  canPause,
  canResume,
  canCancel,
  downloadProgress,
  downloadBytes,
  onDownload,
  onSelect,
  onDelete,
  onPause,
  onResume,
  onCancel,
}) => {
  const present = presentModelIds.includes(model.id);
  const active = downloadedModelId === model.id;
  // WHISPER_MODELS sizes are in MB. Surface bytes so the STT card matches the
  // Text/Image cards ("X MB / Y MB"); for a queued model this reads "0 B / 142 MB".
  const totalBytes = model.size * 1024 * 1024;
  const visibleDownloadBytes =
    downloading || queued || paused
      ? downloadBytes ?? {
          downloaded: Math.round(downloadProgress * totalBytes),
          total: totalBytes,
        }
    : undefined;
  return (
    <ModelCard
      compact
      model={{
        id: model.id,
        name: model.name,
        author: formatSize(model.size),
        description: model.description,
      }}
      isDownloaded={present && !downloading && !queued}
      isActive={active}
      isDownloading={downloading}
      isQueued={queued}
      isPaused={paused}
      downloadProgress={downloadProgress}
      downloadBytes={visibleDownloadBytes}
      testID={`transcription-model-card-${index}`}
      // Present but not active → tap to use; not present → tap to download.
      onPress={
        downloading || queued || paused
          ? undefined
          : present
          ? active
            ? undefined
            : () => onSelect(model.id)
          : () => onDownload(model.id)
      }
      onDownload={
        !present && !downloading && !queued && !paused ? () => onDownload(model.id) : undefined
      }
      onPause={canPause ? () => onPause(model.id) : undefined}
      onResume={canResume ? () => onResume(model.id) : undefined}
      onCancel={canCancel ? () => onCancel(model.id) : undefined}
      onDelete={present ? () => onDelete(model.id) : undefined}
    />
  );
};

interface TranscriptionModelsTabProps {
  showRemoteModels?: boolean;
}

export const TranscriptionModelsTab: React.FC<TranscriptionModelsTabProps> = ({
  showRemoteModels = true,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const whisperModels = useWithRemoteCatalog('transcription', WHISPER_MODELS);
  const englishModels = useMemo(() => whisperModels.filter(m => m.lang === 'en'), [whisperModels]);
  const multiModels = useMemo(() => whisperModels.filter(m => m.lang === 'multi'), [whisperModels]);
  // Reuse the Models screen's shared banner styling so it matches the other tabs.
  const shared = useThemedStyles(createModelsScreenStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const remoteLabels = useActiveRemoteModelLabels();

  const {
    downloadedModelId,
    presentModelIds,
    downloadModel,
    selectModel,
    deleteModelById,
    refreshPresentModels,
    error: whisperError,
    clearError,
  } = useWhisperStore();

  // In-flight STT state from the SINGLE owner (canonical download tracker + whisper-store
  // fallback), shared with the Home "Speech" picker so the two surfaces can never disagree.
  // A failed entry reports active=false, so a stuck "downloading" bar can't linger while the
  // Download Manager shows "failed" — the model just becomes downloadable again. Disk probes
  // are deferred until nothing is downloading so an in-flight file isn't mistaken for absent.
  const { stateFor: downloadStateFor, anyDownloading } = useSttDownloadState();

  // Probe disk on mount and whenever downloads finish, so every on-disk model
  // (not just the active one) shows as downloaded.
  useEffect(() => {
    if (!anyDownloading) refreshPresentModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDownloading]);

  // Re-derive from disk whenever the Models screen regains focus (e.g. returning
  // from the Download Manager after a download or delete). Disk is the source of
  // truth, so this keeps the list in sync without any cross-screen wiring.
  useFocusEffect(
    useCallback(() => {
      if (!anyDownloading) refreshPresentModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyDownloading]),
  );

  const handleDownload = useCallback(
    (id: string) => {
    // The store owns downloadingId (set/cleared in downloadModel), so a download
    // started here — or from the chat voice button — shows progress on this tab.
      remoteServerManager.clearActiveRemoteMediaModel('transcription');
      downloadModel(id).catch(err =>
        logger.error('[Transcription] download failed:', err),
      );
    },
    [downloadModel],
  );

  const handleSelect = useCallback(
    (id: string) => {
      remoteServerManager.clearActiveRemoteMediaModel('transcription');
      selectModel(id).catch(err =>
        logger.error('[Transcription] select failed:', err),
      );
    },
    [selectModel],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setAlertState(
        showAlert(
          'Remove Transcription Model',
          `Delete "${whisperModels.find(model => model.id === id)?.name ?? id}"? This will free up about ${formatSize(whisperModels.find(model => model.id === id)?.size ?? 0)}.`,
          [
      { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => {
                setAlertState(hideAlert());
                deleteModelById(id);
              },
            },
          ],
        ),
      );
    },
    [deleteModelById, whisperModels],
  );

  // Fast, Balanced and Best by the shared rule. Multilingual models only: they work for everyone.
  // Re-read when the device reading lands, so picks are never worked out for the fallback RAM.
  const deviceRam = useAppStore(state => state.deviceInfo?.totalMemory);
  const speechPicks = useMemo(
    () => picksAmong(multiModels, model => ({ id: model.id, sizeBytes: model.size * 1e6 }), hardwareService.getTotalMemoryGB()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceRam, multiModels],
  );
  // A pick is shown once, in the row above; the list leaves out that exact model.
  const pickedIds = new Set(speechPicks.map(({ item }) => item.id));
  const speechPickState = (id: string): PickState => {
    if (presentModelIds.includes(id)) {
      return downloadedModelId === id ? { kind: 'active' } : { kind: 'use', onUse: () => handleSelect(id) };
    }
    const state = downloadStateFor(id);
    if (state?.downloading || state?.queued) return { kind: 'downloading', progress: state.progress ?? 0 };
    return { kind: 'download', onDownload: () => handleDownload(id) };
  };

  const renderWhisperCard = (
    model: MobileWhisperCatalogModel,
    index: number,
  ) => {
    const state = downloadStateFor(model.id);
    return (
      <WhisperCard
        key={model.id}
        model={model}
        index={index}
        downloadedModelId={downloadedModelId}
        presentModelIds={presentModelIds}
        downloading={state?.downloading ?? false}
        queued={state?.queued ?? false}
        paused={state?.paused ?? false}
        canPause={state?.canPause ?? false}
        canResume={state?.canResume ?? false}
        canCancel={state?.canCancel ?? false}
        downloadProgress={state?.progress ?? 0}
        downloadBytes={
          state?.totalBytes
            ? {
          downloaded: state.currentBytes ?? 0,
          total: state.totalBytes,
          bytesPerSecond: state.bytesPerSecond,
              }
            : undefined
        }
        onDownload={handleDownload}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onPause={id => { modelDownloadService.pause(uniformDownloadId('stt', id)).catch(error => logger.error('[Transcription] pause failed:', error)); }}
        onResume={id => { modelDownloadService.resume(uniformDownloadId('stt', id)).catch(error => logger.error('[Transcription] resume failed:', error)); }}
        onCancel={id => { modelDownloadService.cancel(uniformDownloadId('stt', id)).catch(error => logger.error('[Transcription] cancel failed:', error)); }}
      />
    );
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={shared.deviceBanner}>
        <Icon
          name={remoteLabels.transcription ? 'cloud' : 'shield'}
          size={11}
          color={colors.trending}
        />
        <Text style={shared.deviceBannerText}>
          {showRemoteModels && remoteLabels.transcription
            ? `${remoteLabels.transcription} runs on your active remote server`
            : 'Transcription runs on your phone, audio is never sent anywhere'}
        </Text>
      </View>

      {whisperError && (
        <TouchableOpacity onPress={clearError}>
          <Text style={styles.error}>{whisperError} (tap to dismiss)</Text>
        </TouchableOpacity>
      )}

      {showRemoteModels && (
        <RemoteModelOptionsSection category="transcription" />
      )}

      <PicksRow testID="speech-picks" items={speechPicks.map(({ slot, item }) => ({
        slot,
        name: item.name,
        sizeBytes: item.size * 1e6,
        state: speechPickState(item.id),
      }))} />

      <Text style={styles.sectionLabel}>English only</Text>
      {englishModels.map((m, i) => renderWhisperCard(m, i))}

      <Text style={styles.sectionLabel}>Multilingual - 99 languages</Text>
      {/* The card keeps its catalogue position as its index, so a card means the same model whatever the picks are. */}
      {multiModels.map((m, i) => (pickedIds.has(m.id) ? null : renderWhisperCard(m, englishModels.length + i)))}

      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())} />
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) =>
  ({
    flex: { flex: 1 },
    content: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs, paddingBottom: SPACING.xxl },
    sectionLabel: {
      ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
      letterSpacing: 0.3, marginBottom: SPACING.sm, marginTop: SPACING.xs,
    },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, textAlign: 'center' as const, marginBottom: SPACING.md },
  });
