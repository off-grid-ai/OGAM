import React from 'react';
import { View, Text, TouchableOpacity, Linking, ScrollView, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { MadeWithLove } from '../components/MadeWithLove';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { GITHUB_URL } from '../utils/sharePrompt';
import { withUtm } from '../utils/utm';
import packageJson from '../../package.json';

const WEDNESDAY_MOBILE_URL = withUtm('https://wednesday.is', 'about');

export const AboutScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const focusTrigger = useFocusTrigger();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* App identity */}
        <View style={styles.heroSection}>
          <Image source={require('../assets/logo.png')} style={staticStyles.appIcon} />
          <Text style={styles.appName}>Off Grid AI</Text>
          <Text style={styles.version}>Version {packageJson.version}</Text>
          <Text style={styles.description}>
            Local AI that runs entirely on your phone. No cloud, no telemetry, nothing leaves the device.
          </Text>
        </View>

        {/* Open Source row */}
        <View style={styles.navSection}>
          <AnimatedListItem
            index={0}
            staggerMs={40}
            trigger={focusTrigger}
            style={[styles.navItem, styles.navItemLast]}
            onPress={() => Linking.openURL(GITHUB_URL)}
          >
            <View style={styles.navItemIcon}>
              <Icon name="github" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Open Source</Text>
              <Text style={styles.navItemDesc}>View the source on GitHub</Text>
            </View>
            <Icon name="external-link" size={14} color={colors.textMuted} />
          </AnimatedListItem>
        </View>

        {/* Built by Wednesday row */}
        <View style={styles.navSection}>
          <AnimatedListItem
            index={1}
            staggerMs={40}
            trigger={focusTrigger}
            style={[styles.navItem, styles.navItemLast]}
            onPress={() => Linking.openURL(WEDNESDAY_MOBILE_URL)}
          >
            <View style={styles.navItemIcon}>
              <Image source={require('../assets/wednesday_logo.png')} style={styles.wednesdayLogo} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Built by Wednesday</Text>
              <Text style={styles.navItemDesc}>We build mobile apps for enterprise teams</Text>
            </View>
            <Icon name="external-link" size={14} color={colors.textMuted} />
          </AnimatedListItem>
        </View>
      </ScrollView>

      {/* Pinned footer */}
      <MadeWithLove />
    </SafeAreaView>
  );
};

const staticStyles = StyleSheet.create({
  appIcon: { width: 72, height: 72, borderRadius: 16, marginBottom: SPACING.md },
});

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  backButton: { width: 36, padding: SPACING.xs },
  headerTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  heroSection: {
    alignItems: 'center' as const,
    paddingVertical: SPACING.xxl,
    marginBottom: SPACING.xl,
  },
  appName: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  version: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: SPACING.md,
  },
  description: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 22,
    paddingHorizontal: SPACING.md,
  },
  navSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navItemLast: { borderBottomWidth: 0 },
  navItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  navItemContent: { flex: 1 },
  navItemTitle: { ...TYPOGRAPHY.body, color: colors.text },
  navItemDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  wednesdayLogo: { width: 24, height: 24, resizeMode: 'contain' as const },
});
