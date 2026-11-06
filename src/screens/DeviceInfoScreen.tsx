import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { hardwareService } from '../services';

export const DeviceInfoScreen: React.FC = () => {
  const navigation = useNavigation();
  const { deviceInfo } = useAppStore();
  const styles = useThemedStyles(createStyles);

  const totalRamGB = hardwareService.getTotalMemoryGB();
  const deviceTier = hardwareService.getDeviceTier();

  // Live per-process memory (os_proc): available, footprint, and the derived LIMIT.
  // The LIMIT (available + footprint) is what iOS actually caps this app at — the real
  // reason a model can be refused on a high-RAM device. Total RAM alone is misleading.
  const [proc, setProc] = useState<{ availableMB: number; footprintMB: number; limitMB: number } | null>(null);
  useEffect(() => {
    let alive = true;
    hardwareService.getProcessMemory()
      .then((p) => { if (alive) setProc(p); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;

  return (
    <AliveScreen style={styles.container}>
      <ScreenHeader title="Device information" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Hardware</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Model</Text>
            <Text style={styles.infoValue}>{deviceInfo?.deviceModel}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>System</Text>
            <Text style={styles.infoValue}>
              {deviceInfo?.systemName} {deviceInfo?.systemVersion}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Memory</Text>
            <Text style={styles.infoValue}>{totalRamGB.toFixed(1)} GB</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Free now</Text>
            <Text style={styles.infoValue}>{proc ? gb(proc.availableMB) : '…'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Used by Off Grid AI</Text>
            <Text style={styles.infoValue}>{proc ? gb(proc.footprintMB) : '…'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Off Grid AI can use up to</Text>
            <Text style={styles.infoValue}>{proc ? gb(proc.limitMB) : '…'}</Text>
          </View>
          <View style={[styles.infoRow, styles.lastRow]}>
            <Text style={styles.infoLabel}>Phone class</Text>
            <Text style={[styles.infoValue, styles.tierBadge]}>
              {deviceTier.charAt(0).toUpperCase() + deviceTier.slice(1)}
            </Text>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Compatibility</Text>
          <Text style={styles.description}>
            Your device tier determines which models will run smoothly. Higher RAM allows larger, more capable models.
          </Text>

          <View style={styles.tierInfo}>
            <View style={[styles.tierItem, deviceTier === 'low' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'low' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Low</Text>
              <Text style={styles.tierDesc}>{'< 4GB RAM'}</Text>
              <Text style={styles.tierModels}>Small models only</Text>
            </View>
            <View style={[styles.tierItem, deviceTier === 'medium' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'medium' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Medium</Text>
              <Text style={styles.tierDesc}>4-6GB RAM</Text>
              <Text style={styles.tierModels}>Most models</Text>
            </View>
            <View style={[styles.tierItem, deviceTier === 'high' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'high' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>High</Text>
              <Text style={styles.tierDesc}>6-8GB RAM</Text>
              <Text style={styles.tierModels}>All models</Text>
            </View>
            <View style={[styles.tierItem, deviceTier === 'flagship' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'flagship' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Flagship</Text>
              <Text style={styles.tierDesc}>{'8GB+ RAM'}</Text>
              <Text style={styles.tierModels}>All models + largest</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  // The shared section-label style, not a heading per card.
  sectionTitle: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    marginBottom: SPACING.md,
  },
  description: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
  infoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  // Numbers and facts in Mono, as everywhere.
  infoValue: {
    ...TYPOGRAPHY.body,
    fontFamily: FONTS.mono,
    color: colors.text,
  },
  tierBadge: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textSecondary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
    overflow: 'hidden' as const,
  },
  tierInfo: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
  // Three tiers side by side on the card's surface; this phone's tier has desktop's chosen state.
  tierItem: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center' as const,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  tierItemActive: {
    backgroundColor: colors.selectedFill,
  },
  tierName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  // Chosen is the grey fill; the name stays ink (hand test 60: an emerald "Flagship").
  tierNameActive: {
    color: colors.text,
  },
  tierDesc: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: SPACING.xs,
  },
  tierModels: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
});
