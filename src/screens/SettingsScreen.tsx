import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { AttachStep } from 'react-native-spotlight-tour';
import { useNavigation, CommonActions, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Card } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { MadeWithLove } from '../components/MadeWithLove';
import { DebugLogsScreen } from '../components/DebugLogsScreen';
import { useSettingsSections } from '../components/settings/sectionRegistry';
import { ProUpsellBanner } from '../components/settings/ProUpsellBanner';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import { useAppStore, useRemoteServerStore } from '../stores';
import { hardwareService } from '../services';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { GITHUB_URL, FOLLOW_X_URL, SLACK_INVITE_URL, shareOnX } from '../utils/sharePrompt';
import { clearProForTesting } from '../services/proLicenseService';
import { loadProFeatures } from '../bootstrap/loadProFeatures';
import { useProStatusLabel } from '../hooks/useProStatusLabel';
import packageJson from '../../package.json';

const FEEDBACK_EMAIL = 'support@offgridmobileai.co';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'SettingsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Reactive: Pro sections registered at runtime (license-key activation re-runs
  // loadProFeatures) show up live without an app restart.
  const settingsSections = useSettingsSections();
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const completeChecklistStep = useAppStore((s) => s.completeChecklistStep);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const deviceInfo = useAppStore((s) => s.deviceInfo);
  // Hidden once the user dismisses it, or once Pro is active (the upsell makes no
  // sense to a paid user). hasRegisteredPro only flips true after RC verification
  // (activateProByEmail / revalidatePro), so this also covers "paid and verified".
  const devProDisabled = useAppStore((s) => s.devProDisabled);
  const setDevProDisabled = useAppStore((s) => s.setDevProDisabled);
  const setHasRegisteredPro = useAppStore((s) => s.setHasRegisteredPro);
  const { proStatusLabel } = useProStatusLabel();

  useEffect(() => {
    completeChecklistStep('exploredSettings');
  }, [completeChecklistStep]);

  const handleSendFeedback = async () => {
    const { downloadedModels, activeModelId } = useAppStore.getState();
    const { activeServerId } = useRemoteServerStore.getState();

    const [buildNumber, fsInfo] = await Promise.all([
      DeviceInfo.getBuildNumber(),
      RNFS.getFSInfo(),
    ]);

    const ramGB = hardwareService.getTotalMemoryGB().toFixed(1);
    const tier = hardwareService.getDeviceTier();
    const freeGB = (fsInfo.freeSpace / (1024 * 1024 * 1024)).toFixed(1);
    const activeModel = downloadedModels.find(m => m.id === activeModelId);
    const modelLine = activeModel ? activeModel.fileName : 'None';
    const remoteServer = activeServerId ? 'Yes' : 'No';
    const deviceLine = deviceInfo
      ? `Device: ${deviceInfo.deviceModel} (${deviceInfo.systemName} ${deviceInfo.systemVersion})`
      : 'Device: Unknown';

    const subject = encodeURIComponent(`[Feedback] Off Grid AI v${packageJson.version}`);
    const body = encodeURIComponent(
      `Hi,\n\n[Describe your feedback or issue here]\n\n` +
      `---\n` +
      `App: v${packageJson.version} (build ${buildNumber})\n` +
      `${deviceLine}\n` +
      `RAM: ${ramGB} GB · Tier: ${tier}\n` +
      `Model: ${modelLine}\n` +
      `Free storage: ${freeGB} GB\n` +
      `Remote server: ${remoteServer}`,
    );
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Could Not Open Mail',
        `Looks like there was an issue. You can reach out to us at ${FEEDBACK_EMAIL}`,
        [{ text: 'OK' }],
      );
    }
  };

  // DEV-only: exercise the same live feature activation/revocation lifecycle as
  // a production entitlement change. Disabling also clears the cached license.
  const handleToggleDevPro = async () => {
    const disabling = !devProDisabled;
    if (disabling) {
      setDevProDisabled(true);
      await clearProForTesting();
      setHasRegisteredPro(false);
    } else {
      setDevProDisabled(false);
      await loadProFeatures(true);
      setHasRegisteredPro(true);
    }
    Alert.alert(
      disabling ? 'Pro disabled (DEV)' : 'Pro enabled (DEV)',
      `Pro features are now ${disabling ? 'unavailable' : 'available'}.`,
    );
  };

  const handleResetOnboarding = () => {
    setOnboardingComplete(false);
    // Navigate to root stack and reset to Onboarding
    // getParent() reaches the RootStack from inside the Tab navigator
    navigation.getParent()?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Onboarding' }],
      })
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* PRO Banner */}
        <ProUpsellBanner trigger={focusTrigger} onGetPro={() => navigation.navigate('ProDetail')} />

        {/* Theme Selector */}
        <AnimatedEntry index={0} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.themeToggleRow}>
            <Text style={styles.themeToggleLabel}>Appearance</Text>
            <View style={styles.themeSelector}>
              {([
                { mode: 'system' as const, icon: 'monitor' },
                { mode: 'light' as const, icon: 'sun' },
                { mode: 'dark' as const, icon: 'moon' },
              ]).map(({ mode, icon }) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeSelectorOption,
                    themeMode === mode && styles.themeSelectorOptionActive,
                  ]}
                  onPress={() => setThemeMode(mode)}
                >
                  <Icon
                    name={icon}
                    size={16}
                    color={themeMode === mode ? colors.background : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </AnimatedEntry>

        {/* Navigation Items */}
        <AttachStep index={5} fill>
          <View style={styles.navSection}>
            {[
              { icon: 'sliders', title: 'Model Settings', desc: 'System prompt, generation, and performance', screen: 'ModelSettings' as const },
              { icon: 'zap', title: 'Experimental Features', desc: 'Features still being tested', screen: 'ExperimentalFeatures' as const },
              { icon: 'wifi', title: 'Remote Servers', desc: 'Connect to Off Grid AI Desktop, Ollama, LM Studio, and more', screen: 'RemoteServers' as const },
            //  { icon: 'search', title: 'Web Search', desc: 'Configure search API key for reliable results', screen: 'WebSearchSettings' as const },
              { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
              { icon: 'smartphone', title: 'Device Information', desc: 'Hardware and compatibility', screen: 'DeviceInfo' as const },
              { icon: 'hard-drive', title: 'Storage', desc: 'Models and data usage', screen: 'StorageSettings' as const },
            ].map((item, index, arr) => (
              <AnimatedListItem
                key={item.screen}
                index={index + 1}
                staggerMs={40}
                trigger={focusTrigger}
                style={[styles.navItem, index === arr.length - 1 && styles.navItemLast]}
                onPress={() => navigation.navigate(item.screen)}
              >
                <View style={styles.navItemIcon}>
                  <Icon name={item.icon} size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.navItemContent}>
                  <Text style={styles.navItemTitle}>{item.title}</Text>
                  <Text style={styles.navItemDesc}>{item.desc}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </AnimatedListItem>
            ))}
          </View>
        </AttachStep>

        {/* PRO Button */}
        <AnimatedEntry index={6} staggerMs={40} trigger={focusTrigger}>
          <TouchableOpacity
            style={styles.proNavButton}
            onPress={() => navigation.navigate('ProDetail')}
            activeOpacity={0.75}
          >
            <View style={styles.proIconContainer}>
              <IconMC name="crown" size={18} color={colors.primary} />
            </View>
            <View style={styles.proCardText}>
              <View style={styles.proTitleRow}>
                <Text style={styles.proNavTitle}>Off Grid AI PRO</Text>
                <View style={styles.proBadge}>
                  <Text style={styles.proBadgeText}>PRO</Text>
                </View>
              </View>
              <Text style={styles.proDesc}>{proStatusLabel}</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </AnimatedEntry>

        {/* Stay in the loop */}
        <AnimatedEntry index={7} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.followSection}>
            <View style={styles.followHeader}>
              <Text style={styles.followHeaderTitle}>Stay in the loop</Text>
              <Text style={styles.followHeaderDesc}>
                New features land here first, subscribers get promo discounts, and your feedback shapes what gets built next.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.navItem}
              testID="follow-on-x"
              onPress={() => Linking.openURL(FOLLOW_X_URL)}
            >
              <View style={styles.followItemIcon}>
                <Icon name="twitter" size={16} color={colors.primary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Follow @alichherawalla on X</Text>
                <Text style={styles.navItemDesc}>Feature drops, promo discounts, roadmap</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, styles.navItemLast]}
              testID="join-slack"
              onPress={() => Linking.openURL(SLACK_INVITE_URL)}
            >
              <View style={styles.followItemIcon}>
                <IconMC name="slack" size={16} color={colors.primary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Join the Slack community</Text>
                <Text style={styles.navItemDesc}>Issues fixed fast, debug together, early access</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Community */}
        <AnimatedEntry index={8} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={styles.navItem} onPress={() => Linking.openURL(GITHUB_URL)}>
              <View style={styles.navItemIcon}>
                <Icon name="star" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Star on GitHub</Text>
                <Text style={styles.navItemDesc}>Support the open-source project</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItem} onPress={handleSendFeedback}>
              <View style={styles.navItemIcon}>
                <Icon name="mail" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Send Feedback</Text>
                <Text style={styles.navItemDesc}>Report a bug or share a suggestion</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => shareOnX()}>
              <View style={styles.navItemIcon}>
                <Icon name="share-2" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Share on X</Text>
                <Text style={styles.navItemDesc}>Tell others about Off Grid AI</Text>
              </View>
              <Icon name="external-link" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* About */}
        <AnimatedEntry index={9} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => navigation.navigate('About')}>
              <View style={styles.navItemIcon}>
                <Icon name="info" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>About</Text>
                <Text style={styles.navItemDesc}>Version {packageJson.version}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Privacy */}
        <AnimatedEntry index={10} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.privacyCard}>
            <View style={styles.privacyIconContainer}>
              <Icon name="shield" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.privacyTitle}>Privacy First</Text>
            <Text style={styles.privacyText}>
              All your data stays on this device. No conversations, prompts, or
              personal information is ever sent to any server.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Pro feature sections registered at runtime by @offgrid/pro */}
        {settingsSections.map((Section, i) => <Section key={Section.displayName ?? String(i)} />)}

        {/* Dev-only tooling — stripped from release builds */}
        {__DEV__ && (
          <AnimatedEntry index={11} staggerMs={40} trigger={focusTrigger}>
            <View style={styles.devButtonGroup}>
              <TouchableOpacity style={styles.devButton} onPress={handleResetOnboarding}>
                <Icon name="rotate-ccw" size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>Reset Onboarding</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.devButton} onPress={resetChecklist}>
                <Icon name="list" size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>Reset Onboarding Checklist</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.devButton} onPress={() => setShowDebugLogs(true)}>
                <Icon name="terminal" size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>Debug Logs</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.devButton} onPress={handleToggleDevPro}>
                <Icon name={devProDisabled ? 'unlock' : 'lock'} size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>{devProDisabled ? 'Turn on Pro (DEV)' : 'Turn off Pro (DEV)'}</Text>
              </TouchableOpacity>
            </View>
          </AnimatedEntry>
        )}

        <MadeWithLove />
        {__DEV__ && <DebugLogsScreen visible={showDebugLogs} onClose={() => setShowDebugLogs(false)} />}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, ...shadows.small, zIndex: 1,
  },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  themeToggleRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const,
    backgroundColor: colors.surface, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.lg, ...shadows.small,
  },
  themeToggleLabel: { ...TYPOGRAPHY.body, color: colors.text },
  themeSelector: { flexDirection: 'row' as const, backgroundColor: colors.surfaceLight, borderRadius: 8, padding: 3, gap: 2 },
  themeSelectorOption: { width: 34, height: 30, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const },
  themeSelectorOptionActive: { backgroundColor: colors.primary },
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
    width: 28, height: 28, borderRadius: 6, backgroundColor: 'transparent',
    alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: SPACING.md,
  },
  navItemContent: { flex: 1 },
  navItemTitle: { ...TYPOGRAPHY.body, fontWeight: '400' as const, color: colors.text },
  navItemDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  followSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: `${colors.primary}40`, // emerald accent so it stands out above About
    ...shadows.small,
  },
  followHeader: { padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  followHeaderTitle: { ...TYPOGRAPHY.body, fontWeight: '400' as const, color: colors.primary },
  followHeaderDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  followItemIcon: {
    width: 28, height: 28, borderRadius: 6, backgroundColor: `${colors.primary}1A`,
    alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: SPACING.md,
  },
  section: { marginBottom: SPACING.lg },
  aboutRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    alignItems: 'center' as const, marginBottom: SPACING.sm,
  },
  aboutLabel: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  aboutValue: { ...TYPOGRAPHY.body, fontWeight: '400' as const, color: colors.text },
  aboutText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 18 },
  privacyCard: { alignItems: 'center' as const, backgroundColor: colors.surface },
  privacyIconContainer: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'transparent',
    alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: SPACING.md,
  },
  privacyTitle: { ...TYPOGRAPHY.h3, color: colors.text, marginBottom: SPACING.sm },
  privacyText: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  devButton: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: SPACING.sm, paddingVertical: SPACING.md, marginTop: SPACING.lg,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' as const, borderRadius: 6,
  },
  devButtonGroup: { gap: 12 },
  devButtonText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  proCardText: { flex: 1 },
  proTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginBottom: 2 },
  proBadge: { backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  proBadgeText: { ...TYPOGRAPHY.labelSmall, color: '#FFFFFF', letterSpacing: 0.5 },
  proDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  proIconContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}1A`, alignItems: 'center' as const, justifyContent: 'center' as const },
  proNavButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    gap: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  proNavTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
});
