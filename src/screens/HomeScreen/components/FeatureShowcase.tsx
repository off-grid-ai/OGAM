import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View, useWindowDimensions } from 'react-native';
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
// Slow enough to read a card and look away; a fast turn read as a rotating ad (hand test 82).
const SHOWCASE_MS = 8000;
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
  // What you get, in plain words, across the phone, Pro and the Mac app. What this phone does free
  // comes first, so the row reads as discovery before any Pro or Mac card (hand test 82). Copy in
  // Mac's voice: the outcome first, nothing to unlock (Mac, 2026-11-06).
  const all: Array<ShowcaseFeature & { tried: boolean }> = [
    { key: 'image', icon: 'image', tried: use.imagesMade > 0, title: 'Describe a picture and watch it appear.', line: 'Made on this phone, with no internet.', onPress: open.image },
    { key: 'speech', icon: 'mic', tried: use.hasSpeech, title: 'Talk instead of typing.', line: 'Your words turn to text right here.', onPress: open.speech },
    { key: 'documents', icon: 'file-text', tried: false, title: 'Ask your own files.', line: 'Add a PDF to a project, then ask it.', onPress: open.documents },
    { key: 'video', icon: 'film', pro: true, tried: use.videosMade > 0, title: 'Turn a line into a clip.', line: 'Short videos, made on this phone.', onPress: open.video },
    { key: 'mac-models', icon: 'monitor', mac: true, tried: false, title: 'Smarter answers from your computer.', line: 'Your phone uses its bigger models.', onPress: open.desktop },
    { key: 'voice', icon: 'volume-2', pro: true, tried: use.hasVoice, title: 'Hear every answer.', line: 'Replies read aloud in a voice you pick.', onPress: open.voice },
    { key: 'mac-dictation', icon: 'type', mac: true, pro: true, tried: false, title: 'Talk, and it types where you are.', line: 'Hold one shortcut in any app on your computer.', onPress: open.desktop },
    { key: 'tools', icon: 'calendar', pro: true, tried: false, title: 'Have it draft your emails.', line: 'It writes them. You check and send.', onPress: open.tools },
    { key: 'mac-recall', icon: 'search', mac: true, pro: true, tried: false, title: 'Find anything that was on your screen.', line: 'Search what your computer saw, meetings too.', onPress: open.desktop },
    { key: 'sync', icon: 'refresh-cw', pro: true, tried: false, title: 'Your chats, on every device.', line: 'Start on your computer, finish here.', onPress: open.sync },
    { key: 'mac-meetings', icon: 'users', mac: true, pro: true, tried: false, title: 'Meetings, written up for you.', line: 'Recorded and transcribed on your computer.', onPress: open.desktop },
    { key: 'mac-clipboard', icon: 'clipboard', mac: true, pro: true, tried: false, title: 'Everything you copy, saved.', line: 'Paste any of it back on your computer.', onPress: open.desktop },
  ];
  // Free phone features lead, then Pro and Mac; inside each group, what has not been tried yet first.
  const isFree = (f: { pro?: boolean; mac?: boolean }) => !f.pro && !f.mac;
  const ordered = [
    ...all.filter(f => isFree(f) && !f.tried), ...all.filter(f => isFree(f) && f.tried),
    ...all.filter(f => !isFree(f) && !f.tried), ...all.filter(f => !isFree(f) && f.tried),
  ];
  return ordered.map(({ tried: _tried, ...feature }) => ({
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
  // The card in view, read by the timer and the drag handlers without restarting the timer.
  const indexRef = useRef(0);
  const dragStartX = useRef(0);
  // Until when the row counts as moving: a tap then would open whatever card passes under the finger.
  const movingUntil = useRef(0);
  const [rowWidth, setRowWidth] = useState(0);
  // Any touch, and coming back to the app, restarts the wait, so the card never changes just before a
  // tap (hand test 88: a timer overdue while the app was away fired on return and swapped the card).
  const [holdSince, setHoldSince] = useState(0);
  const hold = useCallback(() => setHoldSince(Date.now()), []);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
      if (state === 'active') hold();
    });
    return () => sub.remove();
  }, [hold]);
  const last = features.length - 1;

  const jumpTo = useCallback((i: number) => {
    indexRef.current = i;
    scroller.current?.scrollTo({ x: i * step, animated: true });
  }, [step]);

  useEffect(() => {
    if (!active || !appActive || touching || features.length < 2) return undefined;
    const timer = setInterval(() => jumpTo((indexRef.current + 1) % features.length), SHOWCASE_MS);
    return () => clearInterval(timer);
  }, [active, appActive, touching, features.length, jumpTo, holdSince]);

  if (features.length === 0) return null;

  const at = (x: number) => Math.min(last, Math.max(0, Math.round(x / step)));
  // The row loops: a swipe on past the last card comes back to the first, and back past the first
  // goes to the last (hand test 86: it stopped at card 12).
  const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    hold();
    const x = event.nativeEvent.contentOffset.x;
    const from = at(dragStartX.current);
    if (from === last && x > dragStartX.current) jumpTo(0);
    else if (from === 0 && x < dragStartX.current) jumpTo(last);
  };
  // The pip follows the scroll position and nothing else, so it always marks the card in view
  // (hand test 87: after a swipe that followed the timer it lagged one card).
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    movingUntil.current = Date.now() + 250;
    const i = at(event.nativeEvent.contentOffset.x);
    if (i !== index) setIndex(i);
  };
  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = at(event.nativeEvent.contentOffset.x);
    indexRef.current = i;
    setIndex(i);
    setTouching(false);
  };
  // Each pip gets an equal share of the row, up to 44 pt, so the targets are as wide as the row allows.
  const pipWidth = rowWidth > 0 ? Math.min(44, rowWidth / features.length) : undefined;

  return (
    <View style={styles.showcase} testID="feature-showcase">
      <Text style={styles.kicker}>What you can do</Text>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onScrollBeginDrag={event => {
          dragStartX.current = event.nativeEvent.contentOffset.x;
          setTouching(true);
        }}
        onScrollEndDrag={onDragEnd}
        onMomentumScrollEnd={onSettle}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.track}
        style={styles.scroller}
      >
        {features.map(feature => (
          <AnimatedPressable
            key={feature.key}
            hapticType="selection"
            onPress={() => {
              if (Date.now() < movingUntil.current) return;
              feature.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${feature.title} ${feature.line}${feature.mac ? ' On your computer.' : ''}${feature.pro ? ' Pro.' : ''}`}
            testID={`feature-showcase-${feature.key}`}
            style={[styles.card, { width: cardWidth }]}
          >
            <View style={styles.cardTop}>
              <Icon name={feature.icon} size={18} color={colors.textSecondary} />
              {feature.pro || feature.mac ? (
                <Text style={styles.proTag}>{[feature.mac ? 'On your computer' : null, feature.pro ? 'Pro' : null].filter(Boolean).join(' · ')}</Text>
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
        <View
          style={styles.pips}
          accessibilityRole="tablist"
          onLayout={event => setRowWidth(event.nativeEvent.layout.width)}
        >
          {features.map((item, i) => (
            <AnimatedPressable
              key={item.key}
              onPress={() => {
                hold();
                jumpTo(i);
              }}
              style={[styles.pipTarget, pipWidth ? { width: pipWidth } : null]}
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
  // The extra right padding lets the last card snap to the gutter like the others, so its index is exact.
  track: { paddingLeft: SPACING.xl, paddingRight: SPACING.xl + PEEK, gap: SPACING.sm },
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
  },
  // A 44 pt tall target around each small pip.
  pipTarget: {
    height: 44,
    paddingHorizontal: SPACING.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    // Darker than the dot field behind Home, so the row reads as pips (hand test 88).
    backgroundColor: colors.textMuted,
    opacity: 0.5,
  },
  pipOn: {
    opacity: 1,
    width: 18,
    backgroundColor: colors.primary,
  },
});
