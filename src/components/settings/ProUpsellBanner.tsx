import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../AnimatedEntry';
import { Button } from '../Button';
import { AnimatedPressable } from '../AnimatedPressable';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import { useAppStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import {
  SPACING,
  TYPOGRAPHY,
  OFF_GRID_DESKTOP_URL,
} from '../../constants';
import { withUtm } from '../../utils/utm';
import { getPricingCopy } from '../../utils/proPricing';

interface Props {
  /** Re-trigger the entrance animation when the screen regains focus. */
  trigger: number;
  onGetPro: () => void;
  onDesignPartners: () => void;
}

/**
 * Dismissible Settings banner promoting Off Grid AI Pro. Self-gates on the store
 * (hidden once Pro is active or the banner is dismissed). Flat, token-only, and
 * weights <= 400 per docs/design.
 */
export const ProUpsellBanner: React.FC<Props> = ({ trigger, onGetPro, onDesignPartners }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // A saved credential may need device reactivation, but it is never an upsell.
  // Debug access and active Pro features remain separate projections.
  // Offer the upsell whenever this install does NOT have access - which now includes a device the
  // roster has deactivated, not only one that never had a credential.
  const show = useAppStore(
    (s) => !s.proBannerDismissed && !selectHasProAccess(s),
  );
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
              Keep your work in context with memory, Sync, and actions you approve.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => dismiss(true)}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Dismiss Pro offer"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Button title={pricing.cta} variant="primary" size="small" onPress={onGetPro} style={styles.cta} />

        <View style={styles.partnerOffer}>
          <Text style={styles.desc}>
            Fewer than 50 people? Get free lifetime Pro if your business idea fits.
          </Text>
          <AnimatedPressable
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="See the partner offer"
            onPress={onDesignPartners}
          >
            <Text style={styles.linkText}>See the partner offer</Text>
            <Icon name="chevron-right" size={16} color={colors.primary} />
          </AnimatedPressable>
        </View>

        <AnimatedPressable
          style={[styles.linkRow, styles.desktopLink]}
          onPress={() => Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'pro-upsell')).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="Get Off Grid AI Desktop on the website"
        >
          <Text style={styles.linkText}>Get Off Grid AI Desktop</Text>
          <Icon name="external-link" size={16} color={colors.primary} />
        </AnimatedPressable>
      </View>
    </AnimatedEntry>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    borderRadius: 8,
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
  title: { ...TYPOGRAPHY.h2, color: colors.text, marginBottom: SPACING.xs },
  desc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  close: { padding: SPACING.xs, minWidth: 44, minHeight: 44, alignItems: 'center' as const },
  cta: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  partnerOffer: {
    marginHorizontal: SPACING.lg,
    marginBottom: 0,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: SPACING.xs,
  },
  linkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: SPACING.sm,
    minHeight: 44,
    paddingVertical: SPACING.sm,
  },
  linkText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    textDecorationLine: 'underline' as const,
    flex: 1,
  },
  desktopLink: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
