import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  Dimensions,
  Animated,
  TouchableOpacity,
  Linking,
} from 'react-native';
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import {
  ONBOARDING_SLIDES,
  SPACING,
  TYPOGRAPHY,
  FONTS,
  WEDNESDAY_URL,
} from '../constants';
import { useAppStore } from '../stores';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { discoverLANServers } from '../services/networkDiscovery';
import { remoteServerManager } from '../services';
import { RootStackParamList } from '../navigation/types';
import logger from '../utils/logger';

type OnboardingScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

const { width } = Dimensions.get('window');

/** Animated slide with staggered entrance: keyword → title → description */
const SlideContent: React.FC<{
  item: (typeof ONBOARDING_SLIDES)[0];
  isActive: boolean;
  styles: ReturnType<typeof createStyles>;
  accentColor: string;
}> = ({ item, isActive, styles, accentColor }) => {
  const keywordOpacity = useSharedValue(0);
  const keywordTranslateY = useSharedValue(24);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(16);
  const descOpacity = useSharedValue(0);
  const descTranslateY = useSharedValue(12);
  const lineWidth = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      // Reset
      keywordOpacity.value = 0;
      keywordTranslateY.value = 24;
      titleOpacity.value = 0;
      titleTranslateY.value = 16;
      descOpacity.value = 0;
      descTranslateY.value = 12;
      lineWidth.value = 0;

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
    }
  }, [isActive]);

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
    <View testID={`onboarding-slide-${item.id}`} style={styles.slide}>
      <View style={styles.slideInner}>
        {/* Hero keyword */}
        <ReanimatedAnimated.View style={keywordStyle}>
          <Text
            testID={`onboarding-keyword-${item.id}`}
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const setOnboardingComplete = useAppStore(s => s.setOnboardingComplete);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // Kick off non-blocking LAN scan so results are ready by ModelDownloadScreen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const discovered = await discoverLANServers();
        if (cancelled || discovered.length === 0) return;
        const store = useRemoteServerStore.getState();
        const existingEndpoints = new Set(
          store.servers.map(s => s.endpoint.replace(/\/$/, '')),
        );
        for (const server of discovered) {
          if (existingEndpoints.has(server.endpoint.replace(/\/$/, '')))
            continue;
          await remoteServerManager.addServer({
            name: server.name,
            endpoint: server.endpoint,
            providerType: 'openai-compatible',
          });
        }
        logger.log('[Onboarding] Pre-discovered', discovered.length, 'servers');
      } catch (e) {
        logger.warn('[Onboarding] LAN scan skipped:', (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNext = () => {
    if (currentIndex < ONBOARDING_SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      completeOnboarding();
    }
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  const completeOnboarding = () => {
    setOnboardingComplete(true);
    navigation.replace('ModelDownload');
  };

  const renderSlide = ({
    item,
    index,
  }: {
    item: (typeof ONBOARDING_SLIDES)[0];
    index: number;
  }) => (
    <SlideContent
      item={item}
      isActive={currentIndex === index}
      styles={styles}
      accentColor={colors.primary}
    />
  );

  const renderDots = () => (
    <View testID="onboarding-dots" style={styles.dotsContainer}>
      {ONBOARDING_SLIDES.map((_, index) => {
        const inputRange = [
          (index - 1) * width,
          index * width,
          (index + 1) * width,
        ];

        const dotWidth = scrollX.interpolate({
          inputRange,
          outputRange: [8, 24, 8],
          extrapolate: 'clamp',
        });

        const opacity = scrollX.interpolate({
          inputRange,
          outputRange: [0.3, 1, 0.3],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View
            key={index}
            style={[styles.dot, { width: dotWidth, opacity }]}
          />
        );
      })}
    </View>
  );

  const isLastSlide = currentIndex === ONBOARDING_SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <View testID="onboarding-screen" style={styles.container}>
        <View style={styles.header}>
          {!isLastSlide && (
            <Button
              title="Skip"
              variant="ghost"
              onPress={handleSkip}
              testID="onboarding-skip"
            />
          )}
        </View>

        <FlatList
          ref={flatListRef}
          data={ONBOARDING_SLIDES}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.id}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false },
          )}
          onMomentumScrollEnd={e => {
            const index = Math.round(e.nativeEvent.contentOffset.x / width);
            setCurrentIndex(index);
          }}
        />

        {renderDots()}

        <View style={styles.footer}>
          <Button
            title={isLastSlide ? 'Get Started' : 'Next'}
            onPress={handleNext}
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
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    minHeight: 48,
  },
  slide: {
    width,
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
  dotsContainer: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-start' as const,
    alignItems: 'center' as const,
    marginVertical: SPACING.xl,
    paddingHorizontal: SPACING.xxl + 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: SPACING.xs,
  },
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
