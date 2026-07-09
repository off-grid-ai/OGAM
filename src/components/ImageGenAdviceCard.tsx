import React, { useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { AnimatedPressable } from './AnimatedPressable';
import { useAppStore } from '../stores';
import { getImageGenAdvice } from '../utils/imageGenAdvice';

/**
 * In-chat advisory for the GPU (mnn) image path — where the device has no compatible NPU,
 * so a full SD1.5 model is a real speed/quality trade the user must steer. It lives in the
 * CHAT (above the composer, beside the other advisories) rather than buried in settings, so
 * a user hitting slow or garbled generations actually sees the fix. It self-hides once the
 * settings are good (256 / >=20 steps) and can be dismissed for the session.
 *
 * Design: tokens only (COLORS/SPACING/TYPOGRAPHY), Feather vector icons, weights <=400.
 */
export const ImageGenAdviceCard: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const { settings, downloadedImageModels, activeImageModelId } = useAppStore();
  const backend = downloadedImageModels.find(m => m.id === activeImageModelId)?.backend;

  const advice = getImageGenAdvice({
    backend,
    steps: settings.imageSteps ?? 0,
    width: settings.imageWidth ?? 0,
  });
  if (!advice.show || dismissed) return null;

  return (
    <View style={styles.card} testID="image-gen-advice">
      <View style={styles.headerRow}>
        <Icon name="cpu" size={14} color={colors.primary} style={styles.leadIcon} />
        <Text style={styles.title}>Tips for your device</Text>
        <AnimatedPressable onPress={() => setDismissed(true)} hitSlop={8} accessibilityLabel="Dismiss" testID="image-gen-advice-dismiss">
          <Icon name="x" size={16} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>
      <Text style={styles.intro}>
        This device generates on the GPU (no compatible NPU), so quality and speed depend on these settings.
      </Text>
      {advice.raiseSteps && (
        <View style={styles.tipRow} testID="image-gen-advice-steps">
          <Icon name="arrow-up-circle" size={13} color={colors.textSecondary} style={styles.tipIcon} />
          <Text style={styles.tip}>Use 20 or more steps for good quality. Fewer steps look muddy.</Text>
        </View>
      )}
      {advice.lowerSize && (
        <View style={styles.tipRow} testID="image-gen-advice-size">
          <Icon name="minimize-2" size={13} color={colors.textSecondary} style={styles.tipIcon} />
          <Text style={styles.tip}>Try 256 for much faster generation with coherent results.</Text>
        </View>
      )}
      {advice.raiseSize && (
        <View style={styles.tipRow} testID="image-gen-advice-raise-size">
          <Icon name="alert-triangle" size={13} color={colors.textSecondary} style={styles.tipIcon} />
          <Text style={styles.tip}>Use at least 256. Below that the model produces garbled images, not smaller ones.</Text>
        </View>
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  leadIcon: { marginTop: 1 },
  title: {
    ...TYPOGRAPHY.label,
    color: colors.primary,
    flex: 1,
  },
  intro: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  tipRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  tipIcon: { marginTop: 2 },
  tip: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    flex: 1,
  },
});
