import React, { useEffect, useState } from 'react';
import { LowPowerCard } from '../components/LowPowerCard';
import { useWideLayout } from '../hooks/useWideLayout';
import {
  StyleSheet, View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep } from 'react-native-spotlight-tour';
import { useNavigation, CommonActions, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { DebugLogsScreen } from '../components/DebugLogsScreen';
import { useSettingsSections } from '../components/settings/sectionRegistry';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { appVersionLabel } from '../utils/appVersion';
const literalStyles = StyleSheet.create({
  s1: { minWidth: 150, textAlign: 'right', paddingVertical: 4 },
});



type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'SettingsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const wide = useWideLayout();
  const styles = useThemedStyles(createStyles);
  // Reactive: Sections registered at runtime show up live without an app restart.
  const settingsSections = useSettingsSections();
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const userName = useAppStore((s) => s.settings?.userName ?? '');
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const completeChecklistStep = useAppStore((s) => s.completeChecklistStep);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  useEffect(() => {
    completeChecklistStep('exploredSettings');
  }, [completeChecklistStep]);

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
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.content, wide.column]}>


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

        <View style={styles.themeToggleRow}>
          <Text style={styles.themeToggleLabel}>Your name</Text>
          <TextInput
            value={userName}
            onChangeText={(v) => updateSettings({ userName: v.slice(0, 40) } as any)}
            placeholder="What agents call you"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Your name, used by agents"
            style={[{ color: colors.text }, literalStyles.s1]}
          />
        </View>

        {/* Navigation Items — grouped */}
        <AttachStep index={5} fill>
          <View>
          {([
            {
              label: 'Models & AI',
              items: [
                { icon: 'cpu', title: 'Models', desc: 'Browse, download and load text, image and voice models', screen: 'ModelsTab' as any },
                { icon: 'sliders', title: 'Model Settings', desc: 'System prompt, generation, and performance', screen: 'ModelSettings' as const },
                { icon: 'wifi', title: 'Remote Servers', desc: 'Use models running on a computer on your Wi-Fi (Ollama, LM Studio...)', screen: 'RemoteServers' as const },
                { icon: 'zap', title: 'Skills', desc: 'Reusable instructions in the SKILL.md format (Claude, OpenClaw): import, switch on or off, call with /name', screen: 'Skills' as const },
                { icon: 'search', title: 'Tools & Web Search', desc: 'Search provider (SearXNG, DuckDuckGo, Exa, Parallel, Tavily) and tools', screen: 'Tools' as const },
              ],
            },
            {
              label: 'Features',
              items: [
                { icon: 'droplet', title: 'Appearance & AI style', desc: 'Theme, colors, font, text size, bottom bar, and how talkative the AI is', screen: 'Appearance' as const },
                { icon: 'monitor', title: 'Presentation Studio', desc: 'Create PowerPoint decks with templates and export PDF, offline', screen: 'Presentations' as const },
                { icon: 'bookmark', title: 'Pinned', desc: 'Answers you pinned from any chat, in one place', screen: 'Pins' as const },
                { icon: 'clock', title: 'Scheduled tasks', desc: 'Have the AI do something at a set time: a daily briefing, a plan, anything you can ask', screen: 'Schedule' as const },
              ],
            },
            {
              label: 'Off-grid',
              items: [
                { icon: 'compass', title: 'Atlas', desc: 'Emergency cards, Survival Manual, offline maps, phrases, off-grid mode', screen: 'AtlasHub' as const },
                { icon: 'book', title: 'Offline Library', desc: 'Download the Atlas library and offline encyclopedias (WikiMed, Wikipedia, iFixit, Wikivoyage)', screen: 'OfflineLibrary' as const },
              ],
            },
            {
              label: 'System',
              items: [
                { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
                { icon: 'package', title: 'My models', desc: 'Delete models, move them to an SD card, add vision files', screen: 'MyModels' as const },
                { icon: 'hard-drive', title: 'Storage', desc: 'Models and data usage', screen: 'StorageSettings' as const },
                { icon: 'smartphone', title: 'Device Information', desc: 'Hardware and compatibility', screen: 'DeviceInfo' as const },
                { icon: 'save', title: 'Backup & sync', desc: 'Back up and restore; sync with nearby devices', screen: 'Backup' as const },
                { icon: 'users', title: 'Assistant access', desc: 'Control which apps and keyboards can reach the AI', screen: 'AssistantAccess' as const },
                { icon: 'image', title: 'Background images', desc: 'Set a background photo for any screen', screen: 'BackgroundSettings' as const },
              ],
            },
          ] as Array<{ label: string; items: { icon: string; title: string; desc: string; screen: any }[] }>).map((group) => (
            <View key={group.label} style={styles.section}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <View style={styles.navSection}>
                {group.items.map((item, index, arr) => (
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
            </View>
          ))}
          </View>
        </AttachStep>

        {/* Atlas: low-battery mode */}
        <LowPowerCard />

        {/* About */}
        <AnimatedEntry index={9} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => navigation.navigate('About')}>
              <View style={styles.navItemIcon}>
                <Icon name="info" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>About</Text>
                <Text style={styles.navItemDesc}>Version {appVersionLabel()}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </AnimatedEntry>

        {/* Sections registered at runtime through the settings section registry */}
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
            </View>
          </AnimatedEntry>
        )}

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
  groupLabel: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginBottom: SPACING.xs, marginLeft: 2 },
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
