import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../Button';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

/** Shown wherever video would appear when Pro is not active. Saved videos still play. */
export const VideoUpsell: React.FC<{ onGetPro: () => void }> = ({ onGetPro }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.container} testID="video-upsell">
      <View style={styles.iconCircle}>
        <Icon name="film" size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>Video</Text>
      <Text style={styles.body}>
        Turn a sentence or a photo into a short film. Made on your phone or your computer, never in
        the cloud.
      </Text>
      <Button title="Get Pro" variant="primary" size="medium" onPress={onGetPro} style={styles.button} />
    </View>
  );
};

/** The icon circle's diameter. */
const ICON_CIRCLE = 64;

const createStyles = (colors: ThemeColors) =>
  ({
    container: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: SPACING.xl,
      paddingVertical: SPACING.xl,
    },
    iconCircle: {
      width: ICON_CIRCLE,
      height: ICON_CIRCLE,
      borderRadius: ICON_CIRCLE / 2,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.surfaceLight,
      marginBottom: SPACING.lg,
    },
    title: { ...TYPOGRAPHY.h3, color: colors.text, marginBottom: SPACING.sm },
    body: {
      ...TYPOGRAPHY.body,
      color: colors.textSecondary,
      textAlign: 'center' as const,
      lineHeight: 22,
      marginBottom: SPACING.xl,
    },
    button: { minWidth: 160 },
  });
