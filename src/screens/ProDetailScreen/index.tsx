import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import {
  SPACING,
  TYPOGRAPHY,
  OFF_GRID_DESKTOP_BENEFIT,
  OFF_GRID_DESKTOP_URL,
} from '../../constants';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import { useAppStore } from '../../stores';
import { PRO_PAY_PAGE_URL } from '../../services/proLicenseService';
import { withUtm } from '../../utils/utm';
import { loadProFeatures } from '../../bootstrap/loadProFeatures';
import { getPricingCopy } from '../../utils/proPricing';
import { ScreenHeader } from '../../components/ScreenHeader';
import { ProManageSection } from './ProManageSection';
import { ProIncludedSection } from './ProIncludedSection';
import { ProUnlockModal } from './ProUnlockModal';
import type { RootStackParamList } from '../../navigation/types';
import logger from '../../utils/logger';

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
    title: 'Live sync across your devices',
    desc: 'Your chats, projects, files, models, and copied text stay current over your own network, never a cloud relay.',
  },
  {
    icon: 'monitor',
    title: 'Your Desktop does the heavy work',
    desc: 'Create images, transcribe speech, and hear replies with the models active on your named Desktop. You choose which models it serves.',
  },
  {
    icon: 'check-circle',
    title: 'It acts, you approve',
    desc: 'It drafts the reply, files the ticket, updates the doc - never on its own. Every action is yours to approve.',
  },
];

export const ProDetailScreen: React.FC = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasSavedProCredential = useAppStore(s => s.hasSavedProCredential);
  const isProActive = useAppStore(s => s.isProActive);
  const hasProAccess = useAppStore(selectHasProAccess);
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const pricing = getPricingCopy();
  const isDevelopmentAccess = __DEV__ && isProActive && !hasSavedProCredential;
  const deviceStatus = hasProAccess
    ? { icon: 'check', label: 'Pro Active' }
    : isDevelopmentAccess
    ? { icon: 'tool', label: 'Development Access' }
    : null;
  const deviceStatusColor = hasProAccess ? colors.primary : colors.textMuted;

  const openPayPage = () => {
    Linking.openURL(withUtm(PRO_PAY_PAGE_URL, 'pro-detail')).catch(error => {
      logger.error(`[Pro] purchase page failed: ${String(error)}`);
      Alert.alert(
        'Could not open the purchase page',
        'Check your connection and try again.',
      );
    });
  };
  const openDesktop = () => {
    Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'pro-detail')).catch(
      error => {
        logger.error(`[Pro] desktop page failed: ${String(error)}`);
        Alert.alert(
          'Could not open the desktop page',
          'Check your connection and try again.',
        );
      },
    );
  };
  const openVerifyModal = () => setVerifyModalVisible(true);

  // Activation verified: load the pro bundle now so Pro lights up live (the
  // reactive appRoot slot mounts the engine without a restart). Registries dedupe.
  const handleUnlocked = () => {
    loadProFeatures(true).catch(error => {
      logger.error(`[Pro] activation refresh failed: ${String(error)}`);
      Alert.alert(
        'Pro is active',
        'The screen could not refresh. Reopen Off Grid AI to use your Pro features.',
      );
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* The app's one header, like every other screen: a back arrow, the title, and this device's
          entitlement state where a screen's actions go. */}
      <ScreenHeader
        title="Off Grid AI Pro"
        onBack={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigation.navigate('Main', {screen: 'HomeTab'})
        }
        right={
          <View style={styles.headerActions}>
            {deviceStatus ? (
              <View
                style={[
                  styles.proActiveBadge,
                  !hasProAccess && styles.proInactiveBadge,
                ]}
              >
                <Icon
                  name={deviceStatus.icon}
                  size={12}
                  color={deviceStatusColor}
                />
                <Text
                  style={[
                    styles.proActiveBadgeText,
                    !hasProAccess && styles.proInactiveBadgeText,
                  ]}
                >
                  {deviceStatus.label}
                </Text>
              </View>
            ) : null}
            {/* The body already offers "I have a license key" to anyone without Pro; this is the
                shortcut for someone who has it and is re-entering it. */}
            {!hasProAccess && !isDevelopmentAccess ? (
              <TouchableOpacity
                style={styles.headerKeyButton}
                onPress={openVerifyModal}
                accessibilityLabel="I have a license key"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="key" size={16} color={colors.primary} />
              </TouchableOpacity>
            ) : null}
            {!hasProAccess && !isDevelopmentAccess ? (
              <TouchableOpacity
                style={styles.getProButton}
                onPress={openPayPage}
              >
                <Text style={styles.getProButtonText}>Get Pro</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {hasProAccess ? (
          /* Pro, and this device still has it: subscription and device management, then what the
             licence opened up. There is no in-between state - a device that was removed from the licence
             is not Pro, so it sees exactly what someone who never bought it sees. */
          <>
            <ProManageSection />
            <ProIncludedSection />
          </>
        ) : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Intelligence, democratized.</Text>
              <Text style={styles.heroPrimary}>On your device.</Text>
              <Text style={styles.heroSubtitle}>
                Ambient and proactive. It sees your day, remembers it, and gets
                ahead of you - and the model runs on your own hardware, so
                nothing is sent anywhere.
              </Text>
            </View>

            {/* Pricing — flat themed surface. */}
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
              {PILLARS.map(p => (
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

        {/* Cross-device companion. Pro is one mind across laptop + phone, so every
            Pro surface points to Off Grid AI Desktop. Shown in both states. */}
        <TouchableOpacity
          style={styles.desktopRow}
          onPress={openDesktop}
          accessibilityRole="link"
          accessibilityLabel="Get Off Grid AI Desktop"
        >
          <View style={styles.desktopIconWrap}>
            <Icon name="monitor" size={18} color={colors.primary} />
          </View>
          <View style={styles.desktopText}>
            <Text style={styles.desktopTitle}>Get Off Grid AI Desktop</Text>
            <Text style={styles.desktopDesc}>{OFF_GRID_DESKTOP_BENEFIT}</Text>
          </View>
          <Icon name="external-link" size={16} color={colors.textMuted} />
        </TouchableOpacity>
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
  content: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },

  // Header
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  logoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  logoGrid: { gap: 3 },
  logoDotRow: { flexDirection: 'row' as const, gap: 3 },
  logoDot: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  logoText: { ...TYPOGRAPHY.body, color: colors.text },
  headerActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
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
  proInactiveBadge: { borderColor: colors.border },
  proInactiveBadgeText: { color: colors.textMuted },

  // Hero
  hero: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xl,
    alignItems: 'center' as const,
  },
  heroTitle: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    textAlign: 'center' as const,
  },
  heroPrimary: {
    ...TYPOGRAPHY.h1,
    color: colors.primary,
    textAlign: 'center' as const,
    marginBottom: SPACING.md,
  },
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
  pricingLabel: {
    ...TYPOGRAPHY.label,
    color: colors.primary,
    letterSpacing: 0.8,
  },
  pricingTitle: {
    ...TYPOGRAPHY.display,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.xs,
  },
  pricingSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
  },

  // Pillars
  pillarsSection: { paddingHorizontal: SPACING.xl, marginBottom: SPACING.lg },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
  pillarRow: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    alignItems: 'flex-start' as const,
  },
  // No filled circle behind it: a decorative tile is not information, and the icon reads fine on
  // the page. Same treatment as the Sync navigation rows.
  pillarIconWrap: {
    width: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  pillarText: { flex: 1, gap: 3 as number },
  pillarTitle: { ...TYPOGRAPHY.body, color: colors.text },
  pillarDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  // CTAs (Button supplies its own colours/border; these are layout-only).
  ctaButton: {
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  verifyButton: { marginHorizontal: SPACING.xl, marginBottom: SPACING.xl },

  // Desktop companion link
  desktopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  desktopIconWrap: {
    width: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  desktopText: { flex: 1, gap: 3 as number },
  desktopTitle: { ...TYPOGRAPHY.body, color: colors.text },
  desktopDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
