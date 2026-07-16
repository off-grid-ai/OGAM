import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../components/AppSheet';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { WHISPER_MODELS } from '../../services';
import { useWhisperStore } from '../../stores/whisperStore';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Transcription (Whisper) model picker. Whisper keeps a single active STT model,
 * so selecting a model downloads it (auto-loading) and replaces the previous one.
 */
export const WhisperPickerSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const downloadedModelId = useWhisperStore((s) => s.downloadedModelId);
  const isModelLoading = useWhisperStore((s) => s.isModelLoading);
  const presentModelIds = useWhisperStore((s) => s.presentModelIds);
  const downloadProgressById = useWhisperStore((s) => s.downloadProgressById);
  const downloadModel = useWhisperStore((s) => s.downloadModel);
  const selectModel = useWhisperStore((s) => s.selectModel);
  const deleteModelById = useWhisperStore((s) => s.deleteModelById);
  const refreshPresentModels = useWhisperStore((s) => s.refreshPresentModels);

  const anyDownloading = Object.keys(downloadProgressById).length > 0;

  useEffect(() => {
    if (visible && !anyDownloading) refreshPresentModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, anyDownloading]);

  return (
    <AppSheet visible={visible} onClose={onClose} title="TRANSCRIPTION MODEL" enableDynamicSizing>
      <View style={styles.content}>
        {WHISPER_MODELS.map((m) => {
          const active = downloadedModelId === m.id;
          const present = presentModelIds.includes(m.id);
          // Per-model: show this row's own progress, and disable only this row
          // while it downloads — several models can download at once, each with
          // its own percentage (the old single-slot value jumped between them).
          const progress = downloadProgressById[m.id];
          const busy = progress !== undefined;
          return (
            <AnimatedPressable
              key={m.id}
              style={[styles.row, active && styles.rowActive]}
              hapticType="selection"
              disabled={busy}
              onPress={() => { if (present) { if (!active) selectModel(m.id); } else downloadModel(m.id); }}
            >
              <View style={styles.rowInfo}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.name}{m.lang === 'multi' ? ' · 99 langs' : ' · EN'}
                </Text>
                <Text style={styles.desc} numberOfLines={1}>{m.description}</Text>
                <Text style={styles.meta}>{m.size} MB</Text>
              </View>
              {(() => {
                if (busy) return <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>;
                // selectModel sets downloadedModelId optimistically, so the active row IS the one loading —
                // show a spinner on it while it loads (not a premature checkmark), matching text/image.
                if (active && isModelLoading) return <ActivityIndicator testID="model-row-loading" size="small" color={colors.primary} />;
                if (active) return <Icon name="check" size={16} color={colors.primary} />;
                if (present) {
                  return (
                    <AnimatedPressable hapticType="selection" hitSlop={8} onPress={() => deleteModelById(m.id)}>
                      <Icon name="trash-2" size={16} color={colors.textMuted} />
                    </AnimatedPressable>
                  );
                }
                return <Icon name="download" size={16} color={colors.textMuted} />;
              })()}
            </AnimatedPressable>
          );
        })}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.xl, gap: SPACING.sm as number },
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
});
