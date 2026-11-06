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
  /** Lives in Off Grid AI Desktop: the card says so, and opens the Mac app's page. */
  mac?: boolean;
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
  desktop: () => void;
}

/**
 * Everything Off Grid AI does, free and Pro side by side, in the words of what you get. Home is the
 * one place Pro is offered (brand Mobile profile), so a Pro card opens Pro for someone without it.
 * What you have not tried comes first.
 */
export function showcaseFeatures(use: FeatureUse, open: FeatureOpeners, isPro: boolean): ShowcaseFeature[] {
  // What you get, in plain words, across the phone, Pro and the Mac app, mixed so a swipe shows all
  // three. Copy in Mac's voice: the outcome first, nothing to unlock (Mac, 2026-11-06).
  const all: Array<ShowcaseFeature & { tried: boolean }> = [
    { key: 'image', icon: 'image', tried: use.imagesMade > 0, title: 'Describe it, and see it.', line: 'Pictures made on this phone, offline.', onPress: open.image },
    { key: 'video', icon: 'film', pro: true, tried: use.videosMade > 0, title: 'Turn a line into a clip.', line: 'Short videos, made on this phone.', onPress: open.video },
    { key: 'mac-models', icon: 'monitor', mac: true, tried: false, title: 'Run the big models on your Mac.', line: 'Your phone uses them over Wi-Fi.', onPress: open.desktop },
    { key: 'speech', icon: 'mic', tried: use.hasSpeech, title: 'Talk instead of typing.', line: 'Your words turn to text right here.', onPress: open.speech },
    { key: 'voice', icon: 'volume-2', pro: true, tried: use.hasVoice, title: 'Hear every answer.', line: 'Replies read aloud in a voice you pick.', onPress: open.voice },
    { key: 'mac-dictation', icon: 'type', mac: true, pro: true, tried: false, title: 'Talk, and it types where you are.', line: 'Hold Option and Space in any app on your Mac.', onPress: open.desktop },
    { key: 'documents', icon: 'file-text', tried: false, title: 'Ask your own files.', line: 'Add a PDF to a project and ask away.', onPress: open.documents },
    { key: 'tools', icon: 'calendar', pro: true, tried: false, title: 'Let it do the small jobs.', line: 'It drafts the email and adds the meeting.', onPress: open.tools },
    { key: 'mac-recall', icon: 'search', mac: true, pro: true, tried: false, title: 'Find anything you saw on your Mac.', line: 'Search your screen, meetings and notes.', onPress: open.desktop },
    { key: 'sync', icon: 'refresh-cw', pro: true, tried: false, title: 'Your chats, on every device.', line: 'Pair once with your Mac. Pick up anywhere.', onPress: open.sync },
    { key: 'mac-meetings', icon: 'users', mac: true, pro: true, tried: false, title: 'Meetings, written up for you.', line: 'Recorded and transcribed on your Mac.', onPress: open.desktop },
    { key: 'mac-clipboard', icon: 'clipboard', mac: true, pro: true, tried: false, title: 'Never lose a copy again.', line: 'Every copy saved, two keys to paste it back.', onPress: open.desktop },
  ];
  return [...all.filter(f => !f.tried), ...all.filter(f => f.tried)].map(({ tried: _tried, ...feature }) => ({
    ...feature,
    // A Mac feature opens the Mac app's page; a phone Pro feature opens Pro for someone without it.
    onPress: !feature.mac && feature.pro && !isPro ? open.pro : feature.onPress,
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
            accessibilityLabel={`${feature.title} ${feature.line}${feature.mac ? ' On your Mac.' : ''}${feature.pro ? ' Pro.' : ''}`}
            testID={`feature-showcase-${feature.key}`}
            style={[styles.card, { width: cardWidth }]}
          >
            <View style={styles.cardTop}>
              <Icon name={feature.icon} size={18} color={colors.textSecondary} />
              {feature.pro || feature.mac ? (
                <Text style={styles.proTag}>{[feature.mac ? 'On your Mac' : null, feature.pro ? 'Pro' : null].filter(Boolean).join(' · ')}</Text>
              ) : null}
            </View>
            <Text style={styles.title} numberOfLines={2}>{feature.title}</Text>
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
