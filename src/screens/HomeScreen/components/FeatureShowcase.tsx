import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../../theme';
import type { ThemeColors } from '../../../theme';
import { cardSurface } from '../../../theme/surface';
import { SPACING, TYPOGRAPHY } from '../../../constants';

export interface ShowcaseFeature {
  key: string;
  icon: string;
  /** What you get, in a few words. */
  title: string;
  /** The first step, in one line. */
  line: string;
  /** Part of Pro: the card says so, and opens Pro for someone without it. */
  pro?: boolean;
  onPress: () => void;
}

/** How long each card stays before the carousel moves on. */
const SHOWCASE_MS = 4500;
const PEEK = 28;

export interface FeatureUse {
  imagesMade: number;
  videosMade: number;
  hasVoice: boolean;
  hasSpeech: boolean;
}

export interface FeatureOpeners {
  image: () => void;
  video: () => void;
  voice: () => void;
  speech: () => void;
  documents: () => void;
  sync: () => void;
  tools: () => void;
  pro: () => void;
}

/**
 * Everything Off Grid AI does, free and Pro side by side, in the words of what you get. Home is the
 * one place Pro is offered (brand Mobile profile), so a Pro card opens Pro for someone without it.
 * What you have not tried comes first.
 */
export function showcaseFeatures(use: FeatureUse, open: FeatureOpeners, isPro: boolean): ShowcaseFeature[] {
  const all: Array<ShowcaseFeature & { tried: boolean }> = [
    { key: 'image', icon: 'image', tried: use.imagesMade > 0, title: 'Describe it, and see it.', line: 'Make a picture on this phone.', onPress: open.image },
    { key: 'speech', icon: 'mic', tried: use.hasSpeech, title: 'Talk instead of typing.', line: 'Pick a speech model, then just speak.', onPress: open.speech },
    { key: 'documents', icon: 'file-text', tried: false, title: 'Ask your own files.', line: 'Add a document to a project.', onPress: open.documents },
    { key: 'video', icon: 'film', pro: true, tried: use.videosMade > 0, title: 'Turn words into a clip.', line: 'Make a short video.', onPress: open.video },
    { key: 'voice', icon: 'volume-2', pro: true, tried: use.hasVoice, title: 'Hear every answer.', line: 'Pick a voice to read replies aloud.', onPress: open.voice },
    { key: 'sync', icon: 'monitor', pro: true, tried: false, title: "Your Mac's models, here.", line: 'Pair this phone with your Mac.', onPress: open.sync },
    { key: 'tools', icon: 'calendar', pro: true, tried: false, title: 'Let it do things for you.', line: 'Email, calendar and more.', onPress: open.tools },
  ];
  return [...all.filter(f => !f.tried), ...all.filter(f => f.tried)].map(({ tried: _tried, ...feature }) => ({
    ...feature,
    onPress: feature.pro && !isPro ? open.pro : feature.onPress,
  }));
}

/**
 * The top of Home: a row of cards you can swipe, moving on by itself every few seconds while Home is
 * in view and you are not touching it. Pips show where you are and jump to a card.
 */
export const FeatureShowcase: React.FC<{ features: ShowcaseFeature[]; active: boolean }> = ({
  features,
  active,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const cardWidth = width - SPACING.xl * 2 - PEEK;
  const step = cardWidth + SPACING.sm;
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);

  useEffect(() => {
    if (!active || touching || features.length < 2) return undefined;
    const timer = setInterval(() => {
      setIndex(current => {
        const next = (current + 1) % features.length;
        scroller.current?.scrollTo({ x: next * step, animated: true });
        return next;
      });
    }, SHOWCASE_MS);
    return () => clearInterval(timer);
  }, [active, touching, features.length, step]);

  if (features.length === 0) return null;

  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / step));
    setTouching(false);
  };
  const jumpTo = (i: number) => {
    setIndex(i);
    scroller.current?.scrollTo({ x: i * step, animated: true });
  };

  return (
    <View style={styles.showcase} testID="feature-showcase">
      <Text style={styles.kicker}>What you can do</Text>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onScrollBeginDrag={() => setTouching(true)}
        onMomentumScrollEnd={onSettle}
        contentContainerStyle={styles.track}
        style={styles.scroller}
      >
        {features.map(feature => (
          <AnimatedPressable
            key={feature.key}
            hapticType="selection"
            onPress={feature.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${feature.title} ${feature.line}${feature.pro ? ' Pro.' : ''}`}
            testID={`feature-showcase-${feature.key}`}
            style={[styles.card, { width: cardWidth }]}
          >
            <View style={styles.cardTop}>
              <Icon name={feature.icon} size={18} color={colors.textSecondary} />
              {feature.pro ? <Text style={styles.proTag}>Pro</Text> : null}
            </View>
            <Text style={styles.title} numberOfLines={1}>{feature.title}</Text>
            <View style={styles.lineRow}>
              <Text style={styles.line} numberOfLines={1}>{feature.line}</Text>
              <Icon name="arrow-right" size={16} color={colors.primary} />
            </View>
          </AnimatedPressable>
        ))}
      </ScrollView>
      {features.length > 1 ? (
        <View style={styles.pips} accessibilityRole="tablist">
          {features.map((item, i) => (
            <AnimatedPressable
              key={item.key}
              onPress={() => jumpTo(i)}
              hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
              accessibilityRole="tab"
              accessibilityLabel={item.title}
            >
              <View style={[styles.pip, i === index && styles.pipOn]} accessibilityState={{ selected: i === index }} />
            </AnimatedPressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  showcase: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  kicker: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  // Full bleed to the screen edge so the next card peeks in; the track keeps the page gutter.
  scroller: { marginHorizontal: -SPACING.xl },
  track: { paddingHorizontal: SPACING.xl, gap: SPACING.sm },
  card: {
    ...cardSurface(colors),
    padding: SPACING.lg,
    gap: SPACING.xs,
  },
  cardTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: SPACING.xs,
  },
  proTag: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  lineRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  line: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  pips: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderLight,
  },
  pipOn: {
    width: 18,
    backgroundColor: colors.primary,
  },
});
