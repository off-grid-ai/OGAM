import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { SectionLabel } from '../components/SectionLabel';
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
        <SectionLabel title="Hardware" />
        <Card style={styles.section}>
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

        <SectionLabel title="What runs here" />
        <Card style={styles.section}>
          <Text style={styles.description}>
            Your device tier determines which models will run smoothly. Higher RAM allows larger, more capable models.
          </Text>

          <View style={styles.tierInfo}>
            <View style={[styles.tierItem, deviceTier === 'low' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'low' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Low</Text>
              <Text style={styles.tierDesc}>{'< 4GB RAM'}</Text>
              <Text style={styles.tierModels}>Small models only</Text>
            </View>
            <View style={[styles.tierItem, styles.tierDivider, deviceTier === 'medium' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'medium' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Medium</Text>
              <Text style={styles.tierDesc}>4-6GB RAM</Text>
              <Text style={styles.tierModels}>Most models</Text>
            </View>
            <View style={[styles.tierItem, styles.tierDivider, deviceTier === 'high' && styles.tierItemActive]}>
              <Text style={[styles.tierName, deviceTier === 'high' && styles.tierNameActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>High</Text>
              <Text style={styles.tierDesc}>6-8GB RAM</Text>
              <Text style={styles.tierModels}>All models</Text>
            </View>
            <View style={[styles.tierItem, styles.tierDivider, deviceTier === 'flagship' && styles.tierItemActive]}>
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
  // Four tiers as hairline rows, not a grid of boxes inside a box (hand tests 61-63). This phone's
  // tier is the grey row.
  tierInfo: {
    flexDirection: 'column' as const,
  },
  tierItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    // Pulled out by its own padding so the names line up with the text above (hand test 65).
    marginHorizontal: -SPACING.sm,
    borderRadius: 6,
  },
  tierDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  tierItemActive: {
    backgroundColor: colors.surfaceLight,
  },
  tierName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    width: 84,
  },
  // Chosen is the grey fill; the name stays ink (hand test 60: an emerald "Flagship").
  tierNameActive: {
    color: colors.text,
  },
  tierDesc: {
    ...TYPOGRAPHY.meta,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    width: 84,
  },
  tierModels: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
});
