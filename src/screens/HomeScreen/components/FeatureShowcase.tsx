import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../../theme';
import type { ThemeColors } from '../../../theme';
import { SPACING, TYPOGRAPHY } from '../../../constants';

export interface ShowcaseFeature {
  key: string;
  /** What you get, in a few words. */
  title: string;
  /** The first step, in one line. */
  line: string;
  onPress: () => void;
}

/** How long each feature stays before the next one comes in. */
const SHOWCASE_MS = 4500;

export interface FeatureUse {
  imagesMade: number;
  videosMade: number;
  hasVoice: boolean;
  hasSpeech: boolean;
}

/**
 * The features this person has not tried yet, in the words of what they get. Each opens the first
 * step. Once all are tried, Home shows nothing here: the page is for their own work.
 */
export function featuresToTry(
  use: FeatureUse,
  open: { image: () => void; video: () => void; voice: () => void; speech: () => void },
): ShowcaseFeature[] {
  const all: Array<ShowcaseFeature & { tried: boolean }> = [
    { key: 'image', tried: use.imagesMade > 0, title: 'Describe it, and see it.', line: 'Make your first picture.', onPress: open.image },
    { key: 'video', tried: use.videosMade > 0, title: 'Turn words into a clip.', line: 'Make your first video.', onPress: open.video },
    { key: 'voice', tried: use.hasVoice, title: 'Hear every answer.', line: 'Pick a voice to read replies aloud.', onPress: open.voice },
    { key: 'speech', tried: use.hasSpeech, title: 'Talk instead of typing.', line: 'Pick a speech model, then just speak.', onPress: open.speech },
  ];
  return all.filter(feature => !feature.tried).map(({ tried: _tried, ...feature }) => feature);
}

/**
 * The top of Home: one feature you have not tried, as a tap that starts it, turning to the next every
 * few seconds (a JS timer once per turn, the fade itself runs natively). Pips show where you are and
 * jump to a feature.
 */
export const FeatureShowcase: React.FC<{ features: ShowcaseFeature[]; active: boolean }> = ({
  features,
  active,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (!active || features.length < 2) return;
    const timer = setInterval(() => setTurn(current => current + 1), SHOWCASE_MS);
    return () => clearInterval(timer);
  }, [active, features.length]);

  if (features.length === 0) return null;
  const index = turn % features.length;
  const feature = features[index];

  return (
    <View style={styles.showcase} testID="feature-showcase">
      <Text style={styles.kicker}>Not tried yet</Text>
      <AnimatedPressable
        hapticType="selection"
        onPress={feature.onPress}
        accessibilityRole="button"
        accessibilityLabel={`${feature.title} ${feature.line}`}
        testID={`feature-showcase-${feature.key}`}
      >
        <Animated.View key={feature.key} entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} style={styles.copy}>
          <Text style={styles.title}>{feature.title}</Text>
          <View style={styles.lineRow}>
            <Text style={styles.line}>{feature.line}</Text>
            <Icon name="arrow-right" size={16} color={colors.primary} />
          </View>
        </Animated.View>
      </AnimatedPressable>
      {features.length > 1 ? (
        <View style={styles.pips} accessibilityRole="tablist">
          {features.map((item, i) => (
            <AnimatedPressable
              key={item.key}
              onPress={() => setTurn(i)}
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
  copy: {
    gap: SPACING.xs,
  },
  // brand Mobile profile: h1 is for rare hero text; this is Home's one hero.
  title: {
    ...TYPOGRAPHY.h1,
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
  },
  pips: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    paddingTop: SPACING.xs,
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
