import React, { useEffect } from 'react';
import { View, Text, Image, Linking } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { activeLocale, t } from '@offgrid/i18n';
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { AliveScreen } from '../components/AliveScreen';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import {
  ONBOARDING_INTRO,
  type OnboardingIntro,
  SPACING,
  TYPOGRAPHY,
  FONTS,
  WEDNESDAY_URL,
} from '../constants';
import { RootStackParamList } from '../navigation/types';

type OnboardingScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

/** The intro, with a staggered entrance: keyword → line → title → description. */
const IntroContent: React.FC<{
  item: OnboardingIntro;
  styles: ReturnType<typeof createStyles>;
  accentColor: string;
}> = ({ item, styles, accentColor }) => {
  const keywordOpacity = useSharedValue(0);
  const keywordTranslateY = useSharedValue(24);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(16);
  const descOpacity = useSharedValue(0);
  const descTranslateY = useSharedValue(12);
  const lineWidth = useSharedValue(0);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);

    // Stagger: keyword → line → title → description
    keywordOpacity.value = withTiming(1, { duration: 500, easing: ease });
    keywordTranslateY.value = withTiming(0, { duration: 500, easing: ease });
    lineWidth.value = withDelay(
      250,
      withTiming(1, { duration: 400, easing: ease }),
    );
    titleOpacity.value = withDelay(
      350,
      withTiming(1, { duration: 400, easing: ease }),
    );
    titleTranslateY.value = withDelay(
      350,
      withTiming(0, { duration: 400, easing: ease }),
    );
    descOpacity.value = withDelay(
      550,
      withTiming(1, { duration: 400, easing: ease }),
    );
    descTranslateY.value = withDelay(
      550,
      withTiming(0, { duration: 400, easing: ease }),
    );
  }, [
    descOpacity,
    descTranslateY,
    keywordOpacity,
    keywordTranslateY,
    lineWidth,
    titleOpacity,
    titleTranslateY,
  ]);

  const keywordStyle = useAnimatedStyle(() => ({
    opacity: keywordOpacity.value,
    transform: [{ translateY: keywordTranslateY.value }],
  }));

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: lineWidth.value }],
    opacity: lineWidth.value,
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const descStyle = useAnimatedStyle(() => ({
    opacity: descOpacity.value,
    transform: [{ translateY: descTranslateY.value }],
  }));

  return (
    <View testID="onboarding-intro" style={styles.slide}>
      <View style={styles.slideInner}>
        {/* Hero keyword */}
        <ReanimatedAnimated.View style={keywordStyle}>
          <Text
            testID="onboarding-keyword"
            style={[styles.keyword, { color: accentColor }]}
          >
            {item.keyword}
          </Text>
        </ReanimatedAnimated.View>

        {/* Accent line */}
        <ReanimatedAnimated.View
          style={[
            styles.accentLine,
            { backgroundColor: accentColor },
            lineStyle,
          ]}
        />

        {/* Title */}
        <ReanimatedAnimated.View style={titleStyle}>
          <Text style={styles.title}>{item.title}</Text>
        </ReanimatedAnimated.View>

        {/* Description */}
        <ReanimatedAnimated.View style={descStyle}>
          <Text style={styles.description}>{item.description}</Text>
        </ReanimatedAnimated.View>
      </View>
    </View>
  );
};

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  navigation,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // One page about Off Grid AI, then the picks: what you want to do, which ones, how it works, then
  // setup. Onboarding counts as done once the picks are finished or skipped there.
  const getStarted = () => {
    navigation.replace('OnboardingGroups');
  };

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']}>
      <View testID="onboarding-screen" style={styles.container}>
        {/* The language, set to the phone's; one tap opens the same list as Settings → Language. */}
        <View style={styles.languageBar}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Language')}
            style={styles.languageChip}
            testID="onboarding-language"
            accessibilityRole="button"
            accessibilityLabel={t('Language: {0}', activeLocale().name)}
          >
            <Icon name="globe" size={14} color={colors.textSecondary} />
            <Text style={styles.languageText} translate="no">{activeLocale().name}</Text>
            <Icon name="chevron-down" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <IntroContent
          item={ONBOARDING_INTRO}
          styles={styles}
          accentColor={colors.primary}
        />

        <View style={styles.footer}>
          <Button
            title="Get Started"
            variant="hero"
            onPress={getStarted}
            size="large"
            style={styles.nextButton}
            testID="onboarding-next"
          />
          <TouchableOpacity
            onPress={() => Linking.openURL(WEDNESDAY_URL)}
            style={styles.madeWithLove}
          >
            <View style={styles.madeWithLoveRow}>
              <Text style={styles.madeWithLoveText}>
                {'made with '}
                <Text style={styles.heart}>{'♥'}</Text>
                {' by '}
              </Text>
              <Image
                source={require('../assets/wednesday_logo.png')}
                style={styles.wednesdayLogo}
              />
              <Text style={styles.madeWithLoveText}>{'Wednesday'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  slide: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  slideInner: {
    paddingHorizontal: SPACING.xxl + 8,
    alignItems: 'flex-start' as const,
    width: '100%' as const,
  },
  keyword: {
    fontFamily: FONTS.mono,
    fontSize: 48,
    fontWeight: '200' as const,
    letterSpacing: 6,
    marginBottom: SPACING.lg,
  },
  accentLine: {
    height: 2,
    width: 48,
    marginBottom: SPACING.xl,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    textAlign: 'left' as const,
    marginBottom: SPACING.md,
  },
  description: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'left' as const,
    lineHeight: 22,
  },
  languageBar: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  languageChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  footer: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  nextButton: {
    width: '100%' as const,
  },
  madeWithLove: { alignItems: 'center' as const, paddingTop: SPACING.md },
  madeWithLoveText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  heart: { color: '#FF0000', fontSize: 14 },
  wednesdayLink: { textDecorationLine: 'underline' as const },
  wednesdayLogo: {
    width: 20,
    height: 20,
    resizeMode: 'contain' as const,
    marginHorizontal: 4,
  },
  madeWithLoveRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
});
