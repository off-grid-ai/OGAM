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
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { ModelCard } from '../../components';
import { TranscriptionLanguageSelect } from '../../components/TranscriptionLanguageSelect';
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
import { useSttDownloadState } from '../../hooks/useSttDownloadState';
import { modelsFailureMessage, WHISPER_MODELS } from '@offgrid/application';
import { createStyles as createModelsScreenStyles } from './styles';
import logger from '../../utils/logger';
import { RemoteModelOptionsSection } from '../../components/models/RemoteModelOptionsSection';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { ModelFailureCard } from '../../components/ModelFailureCard';
import { reportModelFailure } from '../../services/modelFailureHandler';
import { useTranscriptionModelsProjection } from '../../hooks/useTranscriptionModelsProjection';
import {
  downloadTranscriptionModel,
  refreshTranscriptionModels,
  removeTranscriptionModel,
  selectTranscriptionModel,
} from '../../services/transcriptionModelApplication';

const ENGLISH_MODELS = WHISPER_MODELS.filter(m => m.lang === 'en');
const MULTI_MODELS = WHISPER_MODELS.filter(m => m.lang === 'multi');

const formatSize = (mb: number): string =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;

function reportTranscriptionReconcileFailure(error: unknown): void {
  logger.error('[Transcription] disk reconciliation failed:', error);
  reportModelFailure('stt', error, {
    id: 'transcription-models-reconcile',
    title: 'Transcription models are unavailable',
    message:
      error instanceof Error
        ? error.message
        : 'Off Grid AI could not update your transcription models.',
  });
}

interface WhisperCardProps {
  model: (typeof WHISPER_MODELS)[number];
  index: number;
  downloadedModelId: string | null;
  presentModelIds: string[];
  downloading: boolean;
  queued: boolean;
  downloadProgress: number;
  downloadBytes?: {
    downloaded: number;
    total: number;
    bytesPerSecond?: number;
  };
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const WhisperCard: React.FC<WhisperCardProps> = ({
  model,
  index,
  downloadedModelId,
  presentModelIds,
  downloading,
  queued,
  downloadProgress,
  downloadBytes,
  onDownload,
  onSelect,
  onDelete,
}) => {
  const present = presentModelIds.includes(model.id);
  const active = downloadedModelId === model.id;
  // WHISPER_MODELS sizes are in MB. Surface bytes so the STT card matches the
  // Text/Image cards ("X MB / Y MB"); for a queued model this reads "0 B / 142 MB".
  const totalBytes = model.size * 1024 * 1024;
  const visibleDownloadBytes =
    downloading || queued
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
      downloadProgress={downloadProgress}
      downloadBytes={visibleDownloadBytes}
      testID={`transcription-model-card-${index}`}
      // Present but not active → tap to use; not present → tap to download.
      onPress={
        downloading || queued
          ? undefined
          : present
          ? active
            ? undefined
            : () => onSelect(model.id)
          : () => onDownload(model.id)
      }
      onDownload={
        !present && !downloading && !queued
          ? () => onDownload(model.id)
          : undefined
      }
      onDelete={present ? () => onDelete(model.id) : undefined}
    />
  );
};

interface TranscriptionModelsTabProps {
  showLanguageSelector?: boolean;
  showRemoteModels?: boolean;
}

export const TranscriptionModelsTab: React.FC<TranscriptionModelsTabProps> = ({
  showLanguageSelector = true,
  showRemoteModels = true,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Reuse the Models screen's shared banner styling so it matches the other tabs.
  const shared = useThemedStyles(createModelsScreenStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const activeRoute = useActiveMobileModel('transcription').model;
  const activeRemoteModelName =
    activeRoute?.source === 'remote' ? activeRoute.name : null;
  const downloadedModelId =
    activeRoute?.source === 'local' ? activeRoute.id : null;

  const transcription = useTranscriptionModelsProjection();
  const presentModelIds = React.useMemo(
    () =>
      transcription.models
        .filter(row => row.installed)
        .map(row => row.catalog.id),
    [transcription.models],
  );
  const whisperError = transcription.operation?.failure
    ? modelsFailureMessage(transcription.operation.failure)
    : null;

  // In-flight STT state from the SINGLE owner (canonical download tracker + whisper-store
  // fallback), shared with the Home "Speech" picker so the two surfaces can never disagree.
  // A failed entry reports active=false, so a stuck "downloading" bar can't linger while the
  // Download Manager shows "failed" — the model just becomes downloadable again. Disk probes
  // are deferred until nothing is downloading so an in-flight file isn't mistaken for absent.
  const { stateFor: downloadStateFor, anyDownloading } =
    useSttDownloadState(transcription);

  // Probe disk on mount and whenever downloads finish, so every on-disk model
  // (not just the active one) shows as downloaded.
  useEffect(() => {
    if (!anyDownloading) {
      refreshTranscriptionModels().then(outcome => {
        if (!outcome.ok)
          reportTranscriptionReconcileFailure(
            modelsFailureMessage(outcome.failure),
          );
      }, reportTranscriptionReconcileFailure);
    }
  }, [anyDownloading]);

  // Re-derive from disk whenever the Models screen regains focus (e.g. returning
  // from the Download Manager after a download or delete). Disk is the source of
  // truth, so this keeps the list in sync without any cross-screen wiring.
  useFocusEffect(
    useCallback(() => {
      if (!anyDownloading) {
        refreshTranscriptionModels().then(outcome => {
          if (!outcome.ok)
            reportTranscriptionReconcileFailure(
              modelsFailureMessage(outcome.failure),
            );
        }, reportTranscriptionReconcileFailure);
      }
    }, [anyDownloading]),
  );

  useEffect(() => {
    if (!whisperError) return;
    reportModelFailure('stt', whisperError, {
      id: 'transcription-models-workflow',
      title: 'Transcription model unavailable',
      message: whisperError,
    });
  }, [whisperError]);

  const handleDownload = useCallback(async (id: string) => {
    // The store owns downloadingId (set/cleared in downloadModel), so a download
    // started here — or from the chat voice button — shows progress on this tab.
    try {
      const outcome = await downloadTranscriptionModel(id);
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      reportTranscriptionReconcileFailure(error);
    }
  }, []);

  const handleSelect = useCallback(async (id: string) => {
    try {
      const outcome = await selectTranscriptionModel(id);
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      reportTranscriptionReconcileFailure(error);
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    setAlertState(
      showAlert(
        'Remove Transcription Model',
        'This deletes the model files for this language/size.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              setAlertState(hideAlert());
              removeTranscriptionModel(id).then(outcome => {
                if (!outcome.ok)
                  reportTranscriptionReconcileFailure(
                    modelsFailureMessage(outcome.failure),
                  );
              }, reportTranscriptionReconcileFailure);
            },
          },
        ],
      ),
    );
  }, []);

  const renderWhisperCard = (
    model: (typeof WHISPER_MODELS)[number],
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
          name={activeRemoteModelName ? 'cloud' : 'shield'}
          size={11}
          color={colors.trending}
        />
        <Text style={shared.deviceBannerText}>
          {activeRemoteModelName
            ? `${activeRemoteModelName} runs on your active remote server`
            : 'Transcription runs on your phone, audio is never sent anywhere'}
        </Text>
      </View>
      <ModelFailureCard />

      {showLanguageSelector && (
        <TranscriptionLanguageSelect testID="models-transcription-language" />
      )}

      {showRemoteModels && (
        <RemoteModelOptionsSection category="transcription" />
      )}

      <Text style={styles.sectionLabel}>English only</Text>
      {ENGLISH_MODELS.map((m, i) => renderWhisperCard(m, i))}

      <Text style={styles.sectionLabel}>Multilingual - 99 languages</Text>
      {MULTI_MODELS.map((m, i) =>
        renderWhisperCard(m, ENGLISH_MODELS.length + i),
      )}

      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xxl,
  },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
});
