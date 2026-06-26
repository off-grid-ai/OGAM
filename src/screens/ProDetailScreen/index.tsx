import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useAppStore } from '../../stores';
import { PRO_PAY_PAGE_URL } from '../../services/proLicenseService';
import { loadProFeatures } from '../../bootstrap/loadProFeatures';
import { getPricingCopy } from '../../utils/proPricing';
import { ProManageSection } from './ProManageSection';
import { ProUnlockModal } from './ProUnlockModal';

// Off Grid AI Pro is the ambient intelligence layer across desktop + phone, not a
// mobile feature list. These pillars mirror the early-access page framing.
const PILLARS = [
  {
    icon: 'layers',
    title: 'Ambient across your life',
    desc: 'A quiet layer in the background - your laptop, your phone, the meetings in the room, the tabs you read.',
  },
  {
    icon: 'sunrise',
    title: 'Proactive, not reactive',
    desc: 'It briefs you on the day, surfaces what you left open, and drafts the reply before you remember you owe it.',
  },
  {
    icon: 'shield',
    title: 'Private by architecture',
    desc: 'The model runs on your own hardware. No training on your data, no server to leak. Open source, so you can check.',
  },
  {
    icon: 'refresh-cw',
    title: 'One mind across devices',
    desc: 'Your laptop knows your work, your phone knows your life. They sync over your own network, never a cloud relay.',
  },
  {
    icon: 'check-circle',
    title: 'It acts, you approve',
    desc: 'It drafts the reply, files the ticket, updates the doc - never on its own. Every action is yours to approve.',
  },
];

export const ProDetailScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasRegisteredPro = useAppStore((s) => s.hasRegisteredPro);
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const pricing = getPricingCopy();

  const openPayPage = () => { Linking.openURL(PRO_PAY_PAGE_URL).catch(() => {}); };
  const openVerifyModal = () => setVerifyModalVisible(true);

  // Activation verified: load the pro bundle now so Pro lights up live (the
  // reactive appRoot slot mounts the engine without a restart). Registries dedupe.
  const handleUnlocked = () => { loadProFeatures(true).catch(() => {}); };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoGrid}>
              <View style={styles.logoDotRow}>
                <View style={styles.logoDot} />
                <View style={styles.logoDot} />
              </View>
              <View style={styles.logoDotRow}>
                <View style={styles.logoDot} />
                <View style={styles.logoDot} />
              </View>
            </View>
            <Text style={styles.logoText}>Off Grid AI Pro</Text>
          </View>
          {hasRegisteredPro ? (
            <View style={styles.proActiveBadge}>
              <Icon name="check" size={12} color={colors.primary} />
              <Text style={styles.proActiveBadgeText}>Pro Active</Text>
            </View>
          ) : (
            <View style={styles.headerActions}>
              {/* License-key entry, discoverable without scrolling. */}
              <TouchableOpacity
                style={styles.headerKeyButton}
                onPress={openVerifyModal}
                accessibilityLabel="I have a license key"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="key" size={16} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.getProButton} onPress={openPayPage}>
                <Text style={styles.getProButtonText}>Get Pro</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {hasRegisteredPro ? (
          /* Pro active: skip the marketing, show subscription + devices. */
          <ProManageSection />
        ) : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Intelligence, democratized.</Text>
              <Text style={styles.heroPrimary}>On your device.</Text>
              <Text style={styles.heroSubtitle}>
                Ambient and proactive. It sees your day, remembers it, and gets ahead of you - and the model runs on your own hardware, so nothing is sent anywhere.
              </Text>
            </View>

            {/* Pricing — flat themed surface, flips at the July 1 cutover. */}
            <View style={styles.pricingBanner}>
              <View style={styles.pricingLabelRow}>
                <Icon name="zap" size={13} color={colors.primary} />
                <Text style={styles.pricingLabel}>{pricing.label}</Text>
              </View>
              <Text style={styles.pricingTitle}>{pricing.title}</Text>
              <Text style={styles.pricingSubtitle}>{pricing.subtitle}</Text>
            </View>

            {/* Ambient pillars */}
            <View style={styles.pillarsSection}>
              <Text style={styles.sectionLabel}>ONE PRIVATE LAYER</Text>
              {PILLARS.map((p) => (
                <View key={p.title} style={styles.pillarRow}>
                  <View style={styles.pillarIconWrap}>
                    <Icon name={p.icon} size={18} color={colors.primary} />
                  </View>
                  <View style={styles.pillarText}>
                    <Text style={styles.pillarTitle}>{p.title}</Text>
                    <Text style={styles.pillarDesc}>{p.desc}</Text>
                  </View>
                </View>
              ))}
              <Text style={styles.julyNote}>
                We are building this through July. The full layer lands over the month, added as it ships.
              </Text>
            </View>

            {/* CTAs — shared Button (outline). Buy is primary, verify is secondary. */}
            <Button
              title={pricing.cta}
              variant="primary"
              size="large"
              onPress={openPayPage}
              style={styles.ctaButton}
            />
            <Button
              title="I have a license key"
              variant="secondary"
              onPress={openVerifyModal}
              style={styles.verifyButton}
            />
          </>
        )}
      </ScrollView>

      <ProUnlockModal
        visible={verifyModalVisible}
        onClose={() => setVerifyModalVisible(false)}
        onUnlocked={handleUnlocked}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: SPACING.xxl },

  // Header
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  logoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  logoGrid: { gap: 3 },
  logoDotRow: { flexDirection: 'row' as const, gap: 3 },
  logoDot: { width: 6, height: 6, borderRadius: 1, backgroundColor: colors.primary },
  logoText: { ...TYPOGRAPHY.body, color: colors.text },
  headerActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  headerKeyButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  getProButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
  },
  getProButtonText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
  proActiveBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
  },
  proActiveBadgeText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },

  // Hero
  hero: { paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xl, alignItems: 'center' as const },
  heroTitle: { ...TYPOGRAPHY.h1, color: colors.text, textAlign: 'center' as const },
  heroPrimary: { ...TYPOGRAPHY.h1, color: colors.primary, textAlign: 'center' as const, marginBottom: SPACING.md },
  heroSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },

  // Pricing banner
  pricingBanner: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    ...shadows.small,
  },
  pricingLabelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  pricingLabel: { ...TYPOGRAPHY.label, color: colors.primary, letterSpacing: 0.8 },
  pricingTitle: { ...TYPOGRAPHY.display, color: colors.text, textAlign: 'center' as const, marginBottom: SPACING.xs },
  pricingSubtitle: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },

  // Pillars
  pillarsSection: { paddingHorizontal: SPACING.xl, marginBottom: SPACING.lg },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
  pillarRow: { flexDirection: 'row' as const, gap: SPACING.md, paddingVertical: SPACING.md, alignItems: 'flex-start' as const },
  pillarIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  pillarText: { flex: 1, gap: 3 as number },
  pillarTitle: { ...TYPOGRAPHY.body, color: colors.text },
  pillarDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  julyNote: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 18, marginTop: SPACING.md },

  // CTAs (Button supplies its own colours/border; these are layout-only).
  ctaButton: { marginHorizontal: SPACING.xl, marginTop: SPACING.sm, marginBottom: SPACING.md },
  verifyButton: { marginHorizontal: SPACING.xl, marginBottom: SPACING.xl },
});
