/**
 * Onboarding step 3: how it works, for what you picked. Each pick is a card that opens its guide
 * page (its own route, so Back returns here); then model setup, with your picks checked.
 */
import React, { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DEFAULT_PICKS } from '@offgrid/features';
import { AliveScreen } from '../../components/AliveScreen';
import { Button } from '../../components/Button';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Pressable } from '../../components/Touchable';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { cardSurface } from '../../theme/surface';
import { useAppStore } from '../../stores/appStore';
import { flowResumed } from '../../services/analytics/analytics';
import type { RootStackParamList } from '../../navigation/types';
import { pickedTopics } from '../../services/onboardingPicks';
import { mobileGuideTopics } from '../GuideScreen/guideTopics';
import { createPicksStyles } from './styles';
import { finishPicks } from './finish';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingGuide'>;
};

export const OnboardingGuideScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createPicksStyles);
  const own = useThemedStyles(createStyles);
  const picks = useAppStore(s => s.onboardingPicks) ?? DEFAULT_PICKS;
  useEffect(() => {
    flowResumed('onboarding', 'guide_shown');
  }, []);
  const topics = useMemo(() => {
    const all = mobileGuideTopics();
    return pickedTopics(picks)
      .map(id => all.find(t => t.id === id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
  }, [picks]);
  return (
    <AliveScreen
      style={styles.container}
      edges={['top', 'bottom']}
      testID="onboarding-guide"
    >
      <ScreenHeader title="How it works" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Your picks</Text>
        <Text style={styles.description}>
          Tap one to see how it works. Next we set up its models.
        </Text>
        {topics.map(topic => (
          <Pressable
            key={topic.id}
            onPress={() => navigation.push('GuideTopic', { id: topic.id })}
            accessibilityRole="button"
            accessibilityLabel={topic.label}
            testID={`onboarding-topic-${topic.id}`}
            style={({ pressed }: { pressed: boolean }) => [
              own.card,
              pressed && own.pressed,
            ]}
          >
            <Icon name={topic.icon} size={20} color={colors.primary} />
            <View style={own.text}>
              <Text style={own.label}>
                {topic.label}
                {topic.pro ? '  ·  Pro' : ''}
              </Text>
              <Text style={own.tagline}>{topic.tagline}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Set up my models"
          variant="primary"
          onPress={() => finishPicks(navigation, picks)}
          style={styles.footerMain}
          testID="onboarding-finish"
        />
      </View>
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  card: {
    ...cardSurface(colors),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  text: { flex: 1, gap: 2 },
  label: { ...TYPOGRAPHY.body, color: colors.text },
  tagline: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
});
