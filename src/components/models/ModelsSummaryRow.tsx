import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ModelRowType } from './ModelsManagerSheet';

type Props = {
  labels: Record<ModelRowType, string>;
  /** Count of downloaded models per type — shown under each caption so the card
   *  carries information at a glance (replaces the separate stats row). */
  counts?: Partial<Record<ModelRowType, number>>;
  isLoading: boolean;
  onPress: () => void;
};

const TYPE_ICONS: { type: ModelRowType; icon: string; caption: string }[] = [
  { type: 'text', icon: 'message-square', caption: 'Text' },
  { type: 'image', icon: 'image', caption: 'Image' },
  { type: 'voice', icon: 'volume-2', caption: 'Voice' },
  { type: 'speech', icon: 'mic', caption: 'Speech' },
];

/**
 * Collapsed Models control. A labelled strip with one captioned icon per model
 * type — emerald + bright caption when that type has an active model, dimmed +
 * muted when not. Tap → manager sheet.
 */
export const ModelsSummaryRow: React.FC<Props> = ({ labels, counts, isLoading, onPress }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <AnimatedPressable style={styles.container} hapticType="selection" testID="models-summary" onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.label}>Models</Text>
        {isLoading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Icon name="chevron-down" size={14} color={colors.textMuted} />}
      </View>
      <View style={styles.icons}>
        {TYPE_ICONS.map(({ type, icon, caption }) => {
          const active = !!labels[type] && labels[type] !== '—';
          const count = counts?.[type];
          return (
            <View
              key={type}
              testID={`model-summary-${type}`}
              // `selected` reflects "this model type has an active model" — the same signal the
              // caption/icon colour encodes visually. Exposed so a test can observe active-vs-dimmed
              // state without inspecting colours (e.g. a remote text model active while local count = 0).
              accessibilityState={{ selected: active }}
              style={[styles.iconCol, !active && styles.inactive]}
            >
              <View style={styles.typeStack}>
                <Icon name={icon} size={18} color={active ? colors.primary : colors.textMuted} />
                <Text style={[styles.caption, active && styles.captionActive]}>{caption}</Text>
              </View>
              {typeof count === 'number' && (
                // Big numeral to the RIGHT of the icon+label, tall enough to span
                // both — fills the gap between types so the row reads at a glance.
                <Text testID={`model-summary-count-${type}`} style={[styles.count, count > 0 && styles.countActive]}>{count}</Text>
              )}
            </View>
          );
        })}
      </View>
    </AnimatedPressable>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  label: { ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted },
  icons: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.sm,
  },
  iconCol: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  inactive: { opacity: 0.35 },
  typeStack: { alignItems: 'center' as const, gap: SPACING.xs },
  caption: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted },
  captionActive: { color: colors.textSecondary },
  // Numeral to the right of the icon+label. Thin (weight 200) and only modestly
  // larger than the icon so it reads as a quiet secondary count, not a loud hero —
  // matches the restrained terminal look. lineHeight spans the stack for centering.
  count: { ...TYPOGRAPHY.display, fontSize: 18, lineHeight: 34, color: colors.textMuted },
  countActive: { color: colors.primary },
});
