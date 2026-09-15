import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { LoadingDots } from '../LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../components/AppSheet';
import { CustomAlert, showAlert, hideAlert, initialAlertState, type AlertState } from '../CustomAlert';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { WHISPER_MODELS } from '../../services/whisperService';
import { useWhisperStore } from '../../stores/whisperStore';
import { useSttDownloadState } from '../../hooks/useSttDownloadState';
import { presentProgress } from '../../utils/progressPresentation';
import { RemoteModelOptionsSection } from './RemoteModelOptionsSection';
import { remoteServerManager } from '../../services/remoteServerManager';

type Props = {
  visible: boolean;
  onClose: () => void;
  onClosed?: () => void;
  onBackToModels?: () => void;
};

/**
 * Transcription (Whisper) model picker. Whisper keeps a single active STT model,
 * so selecting a model downloads it (auto-loading) and replaces the previous one.
 */
export const WhisperPickerSheet: React.FC<Props> = ({
  visible,
  onClose,
  onClosed,
  onBackToModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const downloadedModelId = useWhisperStore(s => s.downloadedModelId);
  const isModelLoading = useWhisperStore(s => s.isModelLoading);
  const presentModelIds = useWhisperStore(s => s.presentModelIds);
  const downloadModel = useWhisperStore(s => s.downloadModel);
  const selectModel = useWhisperStore(s => s.selectModel);
  const deleteModelById = useWhisperStore(s => s.deleteModelById);
  const refreshPresentModels = useWhisperStore(s => s.refreshPresentModels);

  // In-flight download state from the SINGLE owner the Transcription tab also reads, so the picker
  // and the tab can never disagree (the picker used to read only whisperStore.downloadProgressById
  // and missed downloads tracked in the canonical store — device 2026-07-15).
  const { stateFor, anyDownloading } = useSttDownloadState();

  useEffect(() => {
    if (visible && !anyDownloading) refreshPresentModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, anyDownloading]);

  return (
    <>
    <AppSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      onBackPress={onBackToModels}
      title="TRANSCRIPTION MODEL"
      enableDynamicSizing
    >
      <View style={styles.content}>
        <RemoteModelOptionsSection
          category="transcription"
          onSelect={onClose}
        />
        <Text style={styles.sectionLabel}>On-device models</Text>
        {WHISPER_MODELS.map(m => {
          const active = downloadedModelId === m.id;
          const present = presentModelIds.includes(m.id);
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
              onPress={() => {
                remoteServerManager.clearActiveRemoteMediaModel(
                  'transcription',
                );
                if (present) {
                  if (!active) selectModel(m.id);
                } else downloadModel(m.id);
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
                      accessibilityLabel={`Delete ${m.name} transcription model`}
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        setAlertState(showAlert(
                          'Remove Transcription Model',
                          `Delete "${m.name}"? This will free up about ${m.size} MB.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => {
                              setAlertState(hideAlert());
                              deleteModelById(m.id);
                            } },
                          ],
                        ));
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
    <CustomAlert
      visible={alertState.visible}
      title={alertState.title}
      message={alertState.message}
      buttons={alertState.buttons}
      onClose={() => setAlertState(hideAlert())}
    />
    </>
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
