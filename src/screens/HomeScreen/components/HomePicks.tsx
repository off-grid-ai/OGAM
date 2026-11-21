/**
 * Home's "Your picks": what you picked in onboarding (or later in Settings), first on Home, each
 * one tap from where it lives. A Pro pick without Pro leads to Get Pro; one with no screen on the
 * phone opens its guide page. No picks: nothing shows, and Home is as it always was.
 */
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { ListGroup, listRowStyle } from '../../../components/ListGroup';
import { FONTS, SPACING, TYPOGRAPHY } from '../../../constants';
import { useTheme, useThemedStyles } from '../../../theme';
import type { ThemeColors, ThemeShadows } from '../../../theme';
import { useAppStore } from '../../../stores/appStore';
import type { RootStackParamList } from '../../../navigation/types';
import { pickedTopics } from '../../../services/onboardingPicks';
import { mobileGuideTopics } from '../../GuideScreen/guideTopics';
import { useGuideAction } from '../../GuideScreen/useGuideAction';

export const HomePicks: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const picks = useAppStore(s => s.onboardingPicks);
  const actionFor = useGuideAction();
  const topics = useMemo(() => {
    const all = mobileGuideTopics();
    return pickedTopics(picks)
      .map(id => all.find(t => t.id === id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
  }, [picks]);
  if (topics.length === 0) return null;
  return (
    <View style={styles.wrap} testID="home-picks">
      <Text style={styles.label}>Your picks</Text>
      <ListGroup>
        {topics.map(topic => {
          const action = actionFor(topic);
          const open =
            action && !action.external
              ? action.onPress
              : () => navigation.navigate('GuideTopic', { id: topic.id });
          return (
            <AnimatedPressable
              key={topic.id}
              style={styles.row}
              onPress={open}
              hapticType="selection"
              testID={`home-pick-${topic.id}`}
              accessibilityRole="button"
              accessibilityLabel={
                action?.locked
                  ? `${topic.label}, part of Off Grid AI Pro`
                  : topic.label
              }
            >
              <Icon name={topic.icon} size={18} color={colors.textSecondary} />
              <View style={styles.info}>
                <Text style={styles.title}>{topic.label}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {topic.tagline}
                </Text>
              </View>
              {action?.locked ? (
                <IconMC name="crown" size={14} color={colors.textMuted} />
              ) : null}
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </AnimatedPressable>
          );
        })}
      </ListGroup>
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  wrap: { gap: SPACING.sm, marginBottom: SPACING.md },
  label: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  row: { ...listRowStyle, gap: SPACING.md },
  info: { flex: 1 },
  title: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
});
