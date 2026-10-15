import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import {
  TYPOGRAPHY,
  SPACING,
  OFF_GRID_DESKTOP_BENEFIT,
  OFF_GRID_DESKTOP_URL,
} from '../../constants';
import { withUtm } from '../../utils/utm';

/**
 * Shown in the Voice tab when no voice engine is registered — i.e. in a build without the optional pro
 * bundle, which is where on-device text-to-speech lives.
 *
 * This used to be an upsell: a pitch, a "Get Pro" button and a route to the pay page. Voice is free now,
 * so there is nothing to sell and no price to state. What is left is the honest version of the empty
 * state — this build has no voice engine, here is what would appear if it did — plus the free Desktop
 * companion, which can do the talking when your phone cannot.
 */
export const VoiceModelsEmptyState: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.container} testID="voice-models-unavailable">
      <View style={styles.iconCircle}>
        <Icon name="volume-2" size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>Voice models</Text>
      <Text style={styles.body}>
        On-device text-to-speech ships in the optional Pro bundle, and this
        build does not include it. There is nothing to buy: a build with the
        bundle offers every voice to everyone. When it is here, download a voice
        and the assistant can speak its replies, generated in your phone's RAM
        and never sent anywhere.
      </Text>
      <TouchableOpacity
        style={styles.desktopLink}
        onPress={() =>
          Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'voice-models')).catch(
            () => {},
          )
        }
        accessibilityRole="link"
        accessibilityLabel="Get Off Grid AI Desktop"
      >
        <Icon name="monitor" size={14} color={colors.textMuted} />
        <Text style={styles.desktopLinkText}>{OFF_GRID_DESKTOP_BENEFIT}</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
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
  desktopLink: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  desktopLinkText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
});
