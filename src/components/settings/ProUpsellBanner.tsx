import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../AnimatedEntry';
import { Button } from '../Button';
import { useAppStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { getPricingCopy } from '../../utils/proPricing';

const FEATURE_ROWS = [
  [{ icon: 'layers', label: 'AMBIENT' }, { icon: 'sunrise', label: 'PROACTIVE' }],
  [{ icon: 'shield', label: 'PRIVATE' }, { icon: 'refresh-cw', label: 'CROSS-DEVICE' }],
];

interface Props {
  /** Re-trigger the entrance animation when the screen regains focus. */
  trigger: number;
  onGetPro: () => void;
}

/**
 * Dismissible Settings banner promoting Off Grid AI Pro. Self-gates on the store
 * (hidden once Pro is active or the banner is dismissed). Flat, token-only, and
 * weights <= 400 per docs/design.
 */
export const ProUpsellBanner: React.FC<Props> = ({ trigger, onGetPro }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const show = useAppStore((s) => !s.proBannerDismissed && !s.hasRegisteredPro);
  const dismiss = useAppStore((s) => s.setProBannerDismissed);
  const pricing = getPricingCopy();

  if (!show) return null;

  return (
    <AnimatedEntry index={0} staggerMs={40} trigger={trigger}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Off Grid AI Pro</Text>
            <Text style={styles.desc}>
              Intelligence, democratized and on your device. Ambient, proactive, and private.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => dismiss(true)}
            style={styles.close}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          {FEATURE_ROWS.map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((f) => (
                <View key={f.label} style={styles.item}>
                  <View style={styles.iconWrap}>
                    <Icon name={f.icon} size={16} color={colors.primary} />
                  </View>
                  <Text style={styles.label}>{f.label}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <Button title={pricing.cta} variant="primary" onPress={onGetPro} style={styles.cta} />
      </View>
    </AnimatedEntry>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    borderRadius: 12,
    marginBottom: SPACING.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    ...shadows.small,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    padding: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  headerText: { flex: 1, marginRight: SPACING.md },
  title: { ...TYPOGRAPHY.h1, color: colors.primary, marginBottom: SPACING.xs },
  desc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  close: { padding: SPACING.xs },
  grid: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.sm },
  row: { flexDirection: 'row' as const, gap: SPACING.sm },
  item: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  label: { ...TYPOGRAPHY.label, color: colors.text, letterSpacing: 0.5 },
  cta: { margin: SPACING.lg, marginTop: SPACING.sm },
});
