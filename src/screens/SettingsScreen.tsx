import React, { useEffect, useState } from 'react';
import { lockedChatsNotOpen, exportBackup, importBackup } from '../atlasTools/backup';
import { lastBackupText, useBackupReminder } from '../atlasTools/backupReminder';
import { LowPowerCard } from '../components/LowPowerCard';
import { NearbySyncSettings } from '../components/settings/NearbySyncSettings';

import { AssistantAccessCard } from '../components/AssistantAccessCard';
import { useWideLayout } from '../hooks/useWideLayout';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep } from 'react-native-spotlight-tour';
import { useNavigation, CommonActions, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { MadeWithLove } from '../components/MadeWithLove';
import { DebugLogsScreen } from '../components/DebugLogsScreen';
import { useSettingsSections } from '../components/settings/sectionRegistry';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { clearProForTesting } from '../services/proLicenseService';
import { appVersionLabel } from '../utils/appVersion';


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
  // Reactive: Pro sections registered at runtime (license-key activation re-runs
  // loadProFeatures) show up live without an app restart.
  const settingsSections = useSettingsSections();
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const userName = useAppStore((s) => s.settings?.userName ?? '');
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const completeChecklistStep = useAppStore((s) => s.completeChecklistStep);
  const resetChecklist = useAppStore((s) => s.resetChecklist);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  const lastBackupAt = useBackupReminder((s) => s.lastBackupAt);
  const [backupPasswordAction, setBackupPasswordAction] = useState<'export' | 'import' | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const runEncryptedBackup = async () => {
    if (backupPassword.length < 12) { Alert.alert('Password too short', 'Use at least 12 characters. A forgotten password cannot be recovered.'); return; }
    setBackupBusy(true);
    try {
      const result = backupPasswordAction === 'export'
        ? await exportBackup(backupPassword) : await importBackup(backupPassword);
      const skipped = backupPasswordAction === 'export' ? lockedChatsNotOpen() : 0;
      if (result) Alert.alert(backupPasswordAction === 'export' ? 'Encrypted backup saved' : 'Encrypted backup restored',
        String(result) + (skipped ? `\n\n${skipped} PIN-locked chat${skipped === 1 ? ' was' : 's were'} saved as locked ciphertext that only opens on this phone. To move ${skipped === 1 ? 'it' : 'them'} to a new phone, open ${skipped === 1 ? 'it' : 'them'} with ${skipped === 1 ? 'its' : 'their'} PIN, then back up again.` : ''));
      setBackupPassword('');
      setBackupPasswordAction(null);
    } catch (e: any) { Alert.alert('Encrypted backup failed', String(e?.message ?? e)); }
    finally { setBackupBusy(false); }
  };
  // Hidden once the user dismisses it, or once Pro is active (the upsell makes no
  // sense to a paid user). hasRegisteredPro only flips true after RC verification
  // (activateProByEmail / revalidatePro), so this also covers "paid and verified".
  const devProDisabled = useAppStore((s) => s.devProDisabled);
  const setDevProDisabled = useAppStore((s) => s.setDevProDisabled);
  const setHasRegisteredPro = useAppStore((s) => s.setHasRegisteredPro);

  useEffect(() => {
    completeChecklistStep('exploredSettings');
  }, [completeChecklistStep]);

  // DEV-only: flip the Pro auto-unlock. Disabling also clears the cached license
  // so the build behaves like a fresh free install. We flip the store flags
  // synchronously (so the UI drops Pro immediately) and do NOT auto-reload —
  // an immediate reload races the async persist write and rehydrates the old
  // Pro-active state. A manual restart applies feature load/unload (slots
  // registered at boot can't be cleanly torn down at runtime).
  const handleToggleDevPro = async () => {
    const disabling = !devProDisabled;
    if (disabling) {
      setDevProDisabled(true);
      await clearProForTesting();
      setHasRegisteredPro(false);
    } else {
      setDevProDisabled(false);
    }
    Alert.alert(
      disabling ? 'Pro disabled (DEV)' : 'Pro enabled (DEV)',
      `Restart the app to fully ${disabling ? 'unload' : 'load'} Pro features.`,
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
            style={{ color: colors.text, minWidth: 150, textAlign: 'right', paddingVertical: 4 }}
          />
        </View>

        {/* Navigation Items */}
        <AttachStep index={5} fill>
          <View style={styles.navSection}>
            {[
              { icon: 'monitor', title: 'Presentation Studio', desc: 'Create PowerPoint decks with templates and export PDF, offline', screen: 'Presentations' as const },
              { icon: 'bookmark', title: 'Pinned', desc: 'Answers you pinned from any chat, in one place', screen: 'Pins' as const },
              { icon: 'clock', title: 'Scheduled tasks', desc: 'Have the AI do something at a set time: a daily briefing, a plan, anything you can ask', screen: 'Schedule' as const },
              { icon: 'zap', title: 'Skills', desc: 'Reusable instructions in the SKILL.md format (Claude, OpenClaw): import, switch on or off, call with /name', screen: 'Skills' as const },
              { icon: 'droplet', title: 'Appearance & AI style', desc: 'Theme, colors, font, text size, bottom bar, and how talkative the AI is', screen: 'Appearance' as const },
              { icon: 'cpu', title: 'Models', desc: 'Browse, download and load text, image and voice models', screen: 'ModelsTab' as any },
              { icon: 'sliders', title: 'Model Settings', desc: 'System prompt, generation, and performance', screen: 'ModelSettings' as const },
              { icon: 'wifi', title: 'Remote Servers', desc: 'Use models running on a computer on your Wi-Fi (Ollama, LM Studio...)', screen: 'RemoteServers' as const },
              { icon: 'compass', title: 'Atlas', desc: 'Emergency cards, Survival Manual, offline maps, phrases, off-grid mode', screen: 'AtlasHub' as const },
              { icon: 'book', title: 'Offline Library', desc: 'Download the Atlas library and offline encyclopedias (WikiMed, Wikipedia, iFixit, Wikivoyage)', screen: 'OfflineLibrary' as const },
              { icon: 'search', title: 'Tools & Web Search', desc: 'Search provider (SearXNG, DuckDuckGo, Exa, Parallel, Tavily) and tools', screen: 'Tools' as const },
              { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
              { icon: 'smartphone', title: 'Device Information', desc: 'Hardware and compatibility', screen: 'DeviceInfo' as const },
              { icon: 'package', title: 'My models', desc: 'Delete models, move them to an SD card, add vision files', screen: 'MyModels' as const },
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

        <AssistantAccessCard />

        {/* Atlas: low-battery mode */}
        <LowPowerCard />

        <NearbySyncSettings />

        {/* Atlas: backup & restore */}
        <AnimatedEntry index={8} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity style={styles.navItem} onPress={() => {
              Alert.alert('Unencrypted backup', 'This is a readable JSON file of projects and settings only. Project documents and chats are not included; use Encrypted backup to preserve project documents and ordinary chats. Never store plain backups in a shared location.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Export anyway', onPress: async () => {
              try {
                const name = await exportBackup();
                if (name) Alert.alert('Backup saved', `Saved as ${name}. Keep a copy somewhere else too (PC, cloud, SD card). Plain JSON backups do not include project documents, private chats or models. Use Encrypted backup for project files.`);
              } catch (e: any) {
                if (!/cancel/i.test(String(e?.message || e))) Alert.alert('Backup failed', String(e?.message || e));
              }
                } },
              ]);
            }}>
              <View style={styles.navItemIcon}>
                <Icon name="save" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Back up</Text>
                <Text style={styles.navItemDesc}>{lastBackupText(lastBackupAt)}. Agents, lessons, projects and settings (encrypted chats excluded)</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItem} onPress={() => { setBackupPassword(''); setBackupPasswordAction('export'); }}>
              <View style={styles.navItemIcon}><Icon name="lock" size={16} color={colors.textSecondary} /></View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Encrypted backup (chats + project files)</Text>
                <Text style={styles.navItemDesc}>Keeps PIN-locked chats locked; excludes protected projects and model files</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItem} onPress={() => { setBackupPassword(''); setBackupPasswordAction('import'); }}>
              <View style={styles.navItemIcon}><Icon name="unlock" size={16} color={colors.textSecondary} /></View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Restore encrypted backup</Text>
                <Text style={styles.navItemDesc}>Enter password and choose an .atlasbackup file</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => {
              Alert.alert('Restore backup?', 'This replaces your current agents, projects, chats and settings with the ones in the backup file.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Choose file', onPress: async () => {
                  try {
                    const n = await importBackup();
                    if (n) Alert.alert('Restored', `${n} items restored. Close the app completely and open it again to finish.`);
                  } catch (e: any) {
                    if (!/cancel/i.test(String(e?.message || e))) Alert.alert('Restore failed', String(e?.message || e));
                  }
                } },
              ]);
            }}>
              <View style={styles.navItemIcon}>
                <Icon name="upload" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>Restore</Text>
                <Text style={styles.navItemDesc}>Load a backup file (from this or another device)</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
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
                <Text style={styles.navItemDesc}>Version {appVersionLabel()}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
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

      <Modal visible={backupPasswordAction !== null} transparent animationType="fade" onRequestClose={() => { if (!backupBusy) { setBackupPasswordAction(null); setBackupPassword(''); } }}>
        <View style={styles.backupBackdrop}>
          <View style={styles.backupSheet}>
            <Text style={styles.backupTitle}>{backupPasswordAction === 'export' ? 'Protect your backup' : 'Unlock encrypted backup'}</Text>
            <Text style={{ color: colors.textSecondary }}>Use a password of at least 12 characters and keep it safe. Encrypted backups include chats (PIN-locked chats stay locked), project knowledge-base files and searchable text (up to 25 MB of project files), agents and settings. Protected projects are included only if they are unlocked when you back up: they stay sealed with their own PIN and open on a new phone with that PIN. Locked protected projects and downloaded models are not included. Restoring never deletes a protected project or locked chat that is only on this phone.</Text>
            <TextInput placeholder="Backup password" placeholderTextColor={colors.textMuted} secureTextEntry value={backupPassword} onChangeText={setBackupPassword} autoCapitalize="none" autoCorrect={false} style={styles.backupInput} />
            <View style={styles.backupActions}>
              <TouchableOpacity disabled={backupBusy} onPress={() => { setBackupPassword(''); setBackupPasswordAction(null); }}><Text style={{ color: colors.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity disabled={backupBusy} onPress={runEncryptedBackup}><Text style={styles.backupContinueLabel}>{backupBusy ? 'Working…' : 'Continue'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  backupBackdrop: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  backupSheet: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, gap: 14 },
  backupTitle: { color: colors.text, fontSize: 18, fontWeight: '600' as const },
  backupInput: { color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  backupActions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 18 },
  backupContinueLabel: { color: colors.primary, fontWeight: '600' as const },
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
