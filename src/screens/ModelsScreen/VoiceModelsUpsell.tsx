import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

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
        Off Grid Pro adds on-device text-to-speech. The voice model runs in your
        phone's RAM, so what you hear is generated on the device and never sent
        anywhere. Download a voice and the assistant can speak its replies.
      </Text>
      <Button title="Get Pro" variant="primary" size="medium" onPress={onGetPro} style={styles.button} />
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
  });
