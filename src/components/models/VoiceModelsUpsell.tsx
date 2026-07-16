import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../Button';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING, OFF_GRID_DESKTOP_URL } from '../../constants';
import { withUtm } from '../../utils/utm';

interface VoiceModelsUpsellProps {
  /** Navigates to the Pro detail screen. */
  onGetPro: () => void;
}

/**
 * Shown in the Voice tab when no voice engine is registered (free / non-pro
 * builds). The pro feature fills the modelsScreen.voiceTab slot; when it's
 * absent the tab still renders so users can see what Pro adds.
 */
export const VoiceModelsUpsell: React.FC<VoiceModelsUpsellProps> = ({ onGetPro }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.container} testID="voice-models-upsell">
      <View style={styles.iconCircle}>
        <Icon name="volume-2" size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>Voice models</Text>
      <Text style={styles.body}>
        Off Grid AI Pro adds on-device text-to-speech. The voice model runs in your
        phone's RAM, so what you hear is generated on the device and never sent
        anywhere. Download a voice and the assistant can speak its replies.
      </Text>
      <Button title="Get Pro" variant="primary" size="medium" onPress={onGetPro} style={styles.button} />
      <TouchableOpacity
        style={styles.desktopLink}
        onPress={() => Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'voice-upsell')).catch(() => {})}
        accessibilityRole="link"
        accessibilityLabel="Get Off Grid AI Desktop"
      >
        <Icon name="monitor" size={14} color={colors.textMuted} />
        <Text style={styles.desktopLinkText}>Off Grid AI Desktop is free for Mac. Get it.</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  ({
    container: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: SPACING.xl,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
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
    desktopLink: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.xs,
      marginTop: SPACING.lg,
      paddingVertical: SPACING.xs,
    },
    desktopLinkText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  });
