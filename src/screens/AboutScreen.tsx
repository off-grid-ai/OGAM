import React from 'react';
import { View, Text, Linking, ScrollView, Image, StyleSheet } from 'react-native';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { cardSurface } from '../theme/surface';
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
import { appVersion } from '../utils/appVersion';

const WEDNESDAY_MOBILE_URL = withUtm('https://wednesday.is', 'about');

export const AboutScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const focusTrigger = useFocusTrigger();

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="About" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* App identity */}
        <View style={styles.heroSection}>
          <Image source={require('../assets/logo.png')} style={staticStyles.appIcon} />
          <Text style={styles.appName}>Off Grid AI</Text>
          <Text style={styles.version}>Version {appVersion()}</Text>
          <Text style={styles.description}>
            Local AI that runs entirely on your phone. Your chats and files never leave your device.
          </Text>
        </View>

        {/* Open Source row */}
        <View style={styles.navSection}>
          <AnimatedListItem
            index={0}
            staggerMs={40}
            trigger={focusTrigger}
            style={styles.navItem}
            onPress={() => Linking.openURL(GITHUB_URL)}
          >
            <View style={styles.navItemIcon}>
              <Icon name="github" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Open source</Text>
              <Text style={styles.navItemDesc}>View the source on GitHub</Text>
            </View>
            <Icon name="external-link" size={14} color={colors.textMuted} />
          </AnimatedListItem>
        {/* X and Slack live once, in Settings > Community (one home per thing; hand test 84). */}
        {/* Built by Wednesday row */}
          <AnimatedListItem
            index={1}
            staggerMs={40}
            trigger={focusTrigger}
            style={[styles.navItem, styles.navItemLast]}
            onPress={() => Linking.openURL(WEDNESDAY_MOBILE_URL)}
          >
            <View style={styles.navItemIcon}>
              <Image source={require('../assets/wednesday_logo.png')} style={[styles.wednesdayLogo, { tintColor: colors.textSecondary }]} />
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
    </AliveScreen>
  );
};

const staticStyles = StyleSheet.create({
  appIcon: { width: 72, height: 72, borderRadius: 16, marginBottom: SPACING.md },
});

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    zIndex: 1,
  },
  backButton: { width: 36, padding: SPACING.xs },
  headerTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  content: {
    paddingHorizontal: SPACING.xl,
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
  // One surface with hairlines (theme/surface), like every list.
  navSection: {
    ...cardSurface(colors),
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
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
