import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import {
  SPACING,
  TYPOGRAPHY,
  OFF_GRID_DESKTOP_BENEFIT,
  OFF_GRID_DESKTOP_URL,
} from '../../constants';
import { withUtm } from '../../utils/utm';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useIsProActive } from '../../hooks/useIsProActive';
import { ProIncludedSection } from './ProIncludedSection';
import type { RootStackParamList } from '../../navigation/types';

/**
 * What Pro used to be.
 *
 * This screen was the paywall: a price, a "Get Pro" button to the web checkout, and a licence-key field
 * for the buyers who came back. Off Grid AI is free now - voice mode, personas, draft-then-approve
 * actions and Personal Mesh sync are included for everybody - so the sales page has no job left. What
 * remains is the part that was always useful underneath it: a plain index of what the app can do, with
 * rows into the features that this build actually carries.
 *
 * The route keeps the name 'ProDetail' because that is what every entry point in the app navigates to
 * (the Home crown, Settings, the Tools page, the chat assistant gate), and a rename would be churn for a
 * string. Nothing here is for sale: there is no price, no checkout, and no licence key.
 */
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
    icon: 'volume-2',
    title: 'A voice that answers',
    desc: 'On-device speech, so it talks back and you can run the whole thing hands-free. The voice runs in your phone’s RAM.',
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
  // Registration is the honest signal: this says whether the optional pro bundle is part of THIS build,
  // not whether anyone paid. Nothing in the app pays any more; a build either carries the voice/tool/mesh
  // surfaces or it does not.
  const bundleLoaded = useIsProActive();

  const openDesktop = () => {
    Linking.openURL(withUtm(OFF_GRID_DESKTOP_URL, 'pro-detail')).catch(
      () => {},
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* The app's one header, like every other screen: a back arrow, and the title where a screen's
          actions go. There used to be an entitlement badge, a licence-key shortcut and a "Get Pro"
          button here. */}
      <ScreenHeader
        title="Pro features"
        onBack={() => navigation.goBack()}
        right={
          bundleLoaded ? (
            <View style={styles.includedBadge}>
              <Icon name="check" size={12} color={colors.primary} />
              <Text style={styles.includedBadgeText}>Included</Text>
            </View>
          ) : null
        }
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Everything is free.</Text>
          <Text style={styles.heroPrimary}>On your device.</Text>
          <Text style={styles.heroSubtitle}>
            Ambient and proactive. It sees your day, remembers it, and gets
            ahead of you - and the model runs on your own hardware, so nothing
            is sent anywhere. Voice, personas, actions you approve, and sync
            between your own devices are included for everyone: no licence
            needed, nothing to renew.
          </Text>
        </View>

        {/* Doors into the features this build actually carries. Empty on a build without the bundle. */}
        <ProIncludedSection />

        {!bundleLoaded ? (
          <View style={styles.bundleNote}>
            <Icon name="info" size={16} color={colors.textMuted} />
            <Text style={styles.bundleNoteText}>
              This build does not include the optional Pro bundle, so the voice,
              tool and sync surfaces are not registered here. A build with the
              bundle gets them unlocked - there is nothing to buy either way.
            </Text>
          </View>
        ) : null}

        {/* What the app does, without the sales framing it used to carry. */}
        <View style={styles.pillarsSection}>
          <Text style={styles.sectionLabel}>WHAT'S INCLUDED</Text>
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

        {/* Cross-device companion: the Desktop app is free and open source too. */}
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
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },

  // Header
  includedBadge: {
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
  includedBadgeText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },

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

  // Absent-bundle note
  bundleNote: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.sm,
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    padding: SPACING.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bundleNoteText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    flex: 1,
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
    ...shadows.small,
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
