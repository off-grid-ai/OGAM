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
      {TYPE_ICONS.map(({ type, icon, caption }) => {
        const active = !!labels[type] && labels[type] !== '—';
        const count = counts?.[type];
        const isText = type === 'text';
        const inUse = isText && active;
        return (
          <AnimatedPressable
            key={type}
            testID={`model-summary-${type}-open`}
            hapticType="selection"
            accessibilityRole="button"
            accessibilityLabel={inUse ? `Text model: ${labels.text}` : `${caption} models`}
            onPress={() => (onPressType ?? onPress)(type)}
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
                <Icon name={icon} size={14} color={active ? colors.text : colors.textMuted} />
              )}
              <Text
                numberOfLines={1}
                style={[styles.chipText, active && styles.chipTextActive, inUse && styles.chipTextInUse]}
              >
                {inUse ? labels.text : caption}
              </Text>
              {isText && isLoading ? <LoadingDots size={4} color={colors.primary} /> : null}
              {!inUse && typeof count === 'number' && count > 0 && (
                <Text testID={`model-summary-count-${type}`} style={styles.count}>
                  {count}
                </Text>
              )}
            </View>
          </AnimatedPressable>
        );
      })}
      <AnimatedPressable
        testID="models-summary"
        hapticType="selection"
        accessibilityRole="button"
        accessibilityLabel="All models"
        onPress={onPress}
      >
        <View style={styles.chip}>
          <Icon name="sliders" size={14} color={colors.textSecondary} />
          <Text style={styles.chipText}>Models</Text>
        </View>
      </AnimatedPressable>
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
    backgroundColor: colors.surfaceGlass,
    boxShadow: `inset 0px 0px 0px 100px ${colors.primary}1A`,
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
