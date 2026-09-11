import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { LoadingDots } from '../LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../components/AppSheet';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useSttDownloadState } from '../../hooks/useSttDownloadState';
import { presentProgress } from '../../utils/progressPresentation';
import { RemoteModelOptionsSection } from './RemoteModelOptionsSection';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { ModelFailureCard } from '../ModelFailureCard';
import { reportModelFailure } from '../../services/modelFailureHandler';
import logger from '../../utils/logger';
import { modelsFailureMessage } from '@offgrid/application';
import { useTranscriptionModelsProjection } from '../../hooks/useTranscriptionModelsProjection';
import {
  downloadTranscriptionModel,
  refreshTranscriptionModels,
  removeTranscriptionModel,
  selectTranscriptionModel,
} from '../../services/transcriptionModelApplication';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type WhisperPickerOperation = 'download' | 'select' | 'delete' | 'reconcile';

function reportWhisperPickerFailure(
  operation: WhisperPickerOperation,
  error: unknown,
): void {
  logger.error(`[WhisperPicker] ${operation} failed:`, error);
  reportModelFailure('stt', error, {
    id: `whisper-picker-${operation}`,
    title: 'Transcription models are unavailable',
    message: error instanceof Error
      ? error.message
      : 'Off Grid AI could not update your transcription models.',
  });
}

/**
 * Transcription (Whisper) model picker. Whisper keeps a single active STT model,
 * so selecting a model records the route and replaces the previous selection.
 * Microphone demand owns native loading.
 */
export const WhisperPickerSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const activeRoute = useActiveMobileModel('transcription').model;
  const downloadedModelId = activeRoute?.source === 'local'
    ? activeRoute.id
    : null;
  const transcription = useTranscriptionModelsProjection();
  const isModelLoading = transcription.models.some(row => row.loading);
  const whisperError = transcription.operation?.failure
    ? modelsFailureMessage(transcription.operation.failure)
    : null;

  // In-flight download state from the SINGLE owner the Transcription tab also reads, so the picker
  // and the tab can never disagree (the picker used to read only whisperStore.downloadProgressById
  // and missed downloads tracked in the canonical store — device 2026-07-15).
  const { stateFor, anyDownloading } = useSttDownloadState(transcription);

  useEffect(() => {
    if (visible && !anyDownloading) {
      refreshTranscriptionModels().then(outcome => {
        if (!outcome.ok) reportWhisperPickerFailure(
          'reconcile',
          modelsFailureMessage(outcome.failure),
        );
      }, error => reportWhisperPickerFailure('reconcile', error));
    }
  }, [visible, anyDownloading]);

  useEffect(() => {
    if (!visible || !whisperError) return;
    reportModelFailure('stt', whisperError, {
      id: 'whisper-picker-workflow',
      title: 'Transcription model unavailable',
      message: whisperError,
    });
  }, [visible, whisperError]);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="TRANSCRIPTION MODEL"
      enableDynamicSizing
    >
      <ModelFailureCard />
      <View style={styles.content}>
        <RemoteModelOptionsSection
          category="transcription"
          onSelect={onClose}
        />
        <Text style={styles.sectionLabel}>On-device models</Text>
        {transcription.models.map(({ catalog: m, installed: present }) => {
          const active = downloadedModelId === m.id;
          // Per-model in-flight state from the shared owner: this row's own progress, disabled only
          // while it is busy — several models can download at once, each with its own percentage.
          const dl = stateFor(m.id);
          const busy = dl?.active ?? false;
          const progress = dl
            ? presentProgress({
            progress: dl.progress,
            bytesDownloaded: dl.currentBytes,
            totalBytes: dl.totalBytes,
            bytesPerSecond: dl.bytesPerSecond,
            status: dl.queued ? 'pending' : 'running',
              })
            : undefined;
          return (
            <AnimatedPressable
              key={m.id}
              style={[styles.row, active && styles.rowActive]}
              hapticType="selection"
              disabled={busy}
              onPress={async () => {
                if (present) {
                  if (!active) {
                    try {
                      const outcome = await selectTranscriptionModel(m.id);
                      if (!outcome.ok) reportWhisperPickerFailure(
                        'select',
                        modelsFailureMessage(outcome.failure),
                      );
                    } catch (error) {
                      reportWhisperPickerFailure('select', error);
                    }
                  }
                } else {
                  const outcome = await downloadTranscriptionModel(m.id);
                  if (!outcome.ok) reportWhisperPickerFailure(
                    'download',
                    modelsFailureMessage(outcome.failure),
                  );
                }
              }}
            >
              <View style={styles.rowInfo}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.name}
                  {m.lang === 'multi' ? ' · 99 langs' : ' · EN'}
                </Text>
                <Text style={styles.desc} numberOfLines={1}>
                  {m.description}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {dl?.downloading ? progress?.detailText : `${m.size} MB`}
                </Text>
              </View>
              {(() => {
                if (dl?.queued)
                  return (
                    <Icon
                      name="clock"
                      size={16}
                      color={colors.textMuted}
                      testID="whisper-row-queued"
                    />
                  );
                if (dl?.downloading)
                  return (
                    <Text style={styles.percent} testID="whisper-row-progress">
                      {progress?.percentageText ?? 'In progress'}
                    </Text>
                  );
                // selectModel sets downloadedModelId optimistically, so the active row IS the one loading —
                // show a spinner on it while it loads (not a premature checkmark), matching text/image.
                if (active && isModelLoading)
                  return (
                    <LoadingDots
                      color={colors.primary}
                      testID="model-row-loading"
                    />
                  );
                if (active)
                  return <Icon name="check" size={16} color={colors.primary} />;
                if (present) {
                  return (
                    <AnimatedPressable
                      hapticType="selection"
                      hitSlop={8}
                      onPress={() => {
                        removeTranscriptionModel(m.id).then(outcome => {
                          if (!outcome.ok) reportWhisperPickerFailure(
                            'delete',
                            modelsFailureMessage(outcome.failure),
                          );
                        }, error => reportWhisperPickerFailure('delete', error));
                      }}
                    >
                      <Icon name="trash-2" size={16} color={colors.textMuted} />
                    </AnimatedPressable>
                  );
                }
                return (
                  <Icon name="download" size={16} color={colors.textMuted} />
                );
              })()}
            </AnimatedPressable>
          );
        })}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm as number,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowActive: { borderColor: colors.primary },
  rowInfo: { flex: 1, gap: 2 as number },
  name: { ...TYPOGRAPHY.body, color: colors.text },
  desc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  percent: { ...TYPOGRAPHY.meta, color: colors.primary },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
});
