/**
 * The picks a person made in onboarding, as one wrapping row of chips: shown where they start chatting,
 * so the shortcut reads as the end of their setup, not a way around it. No picks: nothing shows.
 */
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { FONTS, RADIUS, SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { useAppStore } from '../../stores/appStore';
import { pickedTopics } from '../../services/onboardingPicks';
import { mobileGuideTopics } from '../GuideScreen/guideTopics';
import { t } from '@offgrid/i18n';

export const PickedChips: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const picks = useAppStore(s => s.onboardingPicks);
  const topics = useMemo(() => {
    const all = mobileGuideTopics();
    return pickedTopics(picks)
      .map(id => all.find(topic => topic.id === id))
      .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  }, [picks]);
  if (topics.length === 0) return null;
  return (
    <View style={styles.wrap} testID="setup-picks">
      <Text style={styles.label}>{t('Your picks')}</Text>
      <View style={styles.chips}>
        {topics.map(topic => (
          <View key={topic.id} style={styles.chip} testID={`setup-pick-${topic.id}`}>
            <Icon name={topic.icon} size={14} color={colors.textSecondary} />
            <Text style={styles.chipText}>{topic.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  wrap: { gap: SPACING.sm },
  label: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
});
