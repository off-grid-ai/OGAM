import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY, PRO_AHA_FEATURES } from '../constants';
import { getPricingCopy } from '../utils/proPricing';

interface ProAhaSheetProps {
  visible: boolean;
  onClose: () => void;
  onRegister: () => void;
}

export const ProAhaSheet: React.FC<ProAhaSheetProps> = ({ visible, onClose, onRegister }) => {
  const styles = useThemedStyles(createStyles);
  const pricing = getPricingCopy();

  const handleCta = () => {
    onClose();
    onRegister();
  };

  return (
    <AppSheet visible={visible} onClose={onClose} enableDynamicSizing title="Off Grid AI Pro">
      <View style={styles.content}>
        <Text style={styles.headline}>It already knows what you did today.</Text>
        <Text style={styles.subheadline}>{pricing.sheetSubheadline}</Text>

        <View style={styles.featureList}>
          {PRO_AHA_FEATURES.map(feature => (
            <View key={feature} style={styles.featureRow}>
              <Icon name="check" size={14} color={styles.checkIcon.color} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.guarantee}>{pricing.sheetFooter}</Text>

        <TouchableOpacity style={styles.ctaButton} onPress={handleCta}>
          <Text style={styles.ctaText}>{pricing.cta}</Text>
        </TouchableOpacity>
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center' as const,
  },
  headline: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.sm,
  },
  subheadline: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: SPACING.md,
  },
  priceRow: {
    marginBottom: SPACING.lg,
  },
  price: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    textAlign: 'center' as const,
  },
  featureList: {
    width: '100%' as const,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  featureRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  checkIcon: {
    color: colors.primary,
  },
  featureText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  guarantee: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginBottom: SPACING.lg,
  },
  ctaButton: {
    width: '100%' as const,
    paddingVertical: SPACING.md,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.sm,
  },
  ctaText: {
    ...TYPOGRAPHY.body,
    color: colors.background,
  },
});
