import React from 'react';
import { ScrollView, StyleSheet, View, Text } from 'react-native';
import { LoadingDots } from '../LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ModelRowLabels, ModelRowType } from './ModelsManagerSheet';

type Props = {
  labels: ModelRowLabels;
  /** Count of downloaded models per type — shown under each caption so the card
   *  carries information at a glance (replaces the separate stats row). */
  counts?: Partial<Record<ModelRowType, number>>;
  isLoading: boolean;
  onPress: () => void;
  onPressType?: (type: ModelRowType) => void;
};

/** Chips are 34 px tall to sit like desktop's; the slop makes each a 44 px touch target. */
const CHIP_SLOP = { top: 5, bottom: 5, left: 2, right: 2 };

const TYPE_ICONS: { type: ModelRowType; icon: string; caption: string }[] = [
  { type: 'text', icon: 'message-square', caption: 'Text' },
  { type: 'image', icon: 'image', caption: 'Image' },
  { type: 'video', icon: 'video', caption: 'Video' },
  { type: 'voice', icon: 'volume-2', caption: 'Voice' },
  { type: 'speech', icon: 'mic', caption: 'Speech' },
  { type: 'search', icon: 'search', caption: 'Search' },
];

/**
 * The models as desktop's composer chips: no box. The first chip names the text model you talk to
 * (emerald, the one thing in use); every other kind is a chip with its count that opens that kind's
 * picker; the last chip opens the model manager. Active kinds read bright, the rest muted.
 */
export const ModelsSummaryRow: React.FC<Props> = ({
  labels,
  counts,
  isLoading,
  onPress,
  onPressType,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.chips}
      testID="models-chips"
    >
      <AnimatedPressable
        testID="models-summary"
        hapticType="selection"
        accessibilityRole="button"
        accessibilityLabel="All models"
        onPress={onPress}
        hitSlop={CHIP_SLOP}
      >
        <View style={styles.chip}>
          <Icon name="sliders" size={14} color={colors.textSecondary} />
          <Text style={styles.chipText}>Models</Text>
        </View>
      </AnimatedPressable>
      {TYPE_ICONS.map(({ type, icon, caption }) => {
        const active = !!labels[type] && labels[type] !== '—';
        const count = counts?.[type];
        const isText = type === 'text';
        const inUse = isText && active;
        // With no text model there is nothing to chat with: the first chip asks for one.
        const needsText = isText && !active;
        return (
          <AnimatedPressable
            key={type}
            testID={`model-summary-${type}-open`}
            hapticType="selection"
            accessibilityRole="button"
            accessibilityLabel={inUse ? `Text model: ${labels.text}` : needsText ? 'Pick a text model' : `${caption} models`}
            onPress={() => (onPressType ?? onPress)(type)}
            hitSlop={CHIP_SLOP}
          >
            <View
              testID={`model-summary-${type}`}
              // `selected`: this kind has an active model (tests read it rather than colours).
              accessibilityState={{ selected: active }}
              style={[styles.chip, inUse && styles.chipInUse]}
            >
              {inUse ? (
                <View style={styles.liveDot} />
              ) : (
                <Icon name={icon} size={14} color={active || needsText ? colors.text : colors.textMuted} />
              )}
              <Text
                numberOfLines={1}
                style={[styles.chipText, (active || needsText) && styles.chipTextActive, inUse && styles.chipTextInUse]}
              >
                {inUse ? labels.text : needsText ? 'Pick a text model' : caption}
              </Text>
              {isText && isLoading ? <LoadingDots size={4} color={colors.primary} /> : null}
              {!inUse && !needsText && typeof count === 'number' && (
                <Text testID={`model-summary-count-${type}`} style={styles.count}>
                  {count}
                </Text>
              )}
            </View>
          </AnimatedPressable>
        );
      })}
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  strip: {
    flexGrow: 0,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
    // Bleed to the screen edges so chips scroll out of view rather than clip at the padding.
    marginHorizontal: -SPACING.md,
  },
  chips: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    height: 34,
    paddingHorizontal: SPACING.md,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    backgroundColor: colors.surfaceGlass,
  },
  // In use: desktop's selected chip, an emerald outline and text on a faint emerald fill.
  chipInUse: {
    borderColor: colors.heroBorder,
    backgroundColor: colors.selectedFill,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  chipTextActive: { color: colors.text },
  chipTextInUse: { color: colors.primary, fontWeight: '500' as const },
  count: { ...TYPOGRAPHY.meta, fontSize: 11, color: colors.textMuted },
});
