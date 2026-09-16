import { activeMobileRoute } from '../services/modelServices/mobileLLMService';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  useNavigation,
  CommonActions,
  CompositeNavigationProp,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Card } from '../components';
import { createStyles } from './SettingsScreen.styles';
import { SettingsAppearanceRow } from './SettingsAppearanceRow';
import { SettingsCommunitySections } from './SettingsCommunitySections';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { MadeWithLove } from '../components/MadeWithLove';
import { DebugLogsScreen } from '../components/DebugLogsScreen';
import { useSettingsSections } from '../components/settings/sectionRegistry';
import { ProUpsellBanner } from '../components/settings/ProUpsellBanner';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import RNFS from 'react-native-fs';
import { useAppStore } from '../stores';
import { activeLocalModelId } from '../services/modelServices/activeRoute';
import { hardwareService } from '../services';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { useHasRegisteredScreen } from '../navigation/screenRegistry';
import { clearProForTesting } from '../services/proLicenseService';
import { useProStatusLabel } from '../hooks/useProStatusLabel';
import { useOpenSync } from '../hooks/useOpenSync';
import { appBuildLabel, appVersion } from '../utils/appVersion';
import { ScreenHeader } from '../components/ScreenHeader';
import { openSupportEmail } from '../utils/supportEmail';

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
  const hasSync = useHasRegisteredScreen('Sync');
  const { isSyncUnlocked, openSync } = useOpenSync();
  const setOnboardingComplete = useAppStore(s => s.setOnboardingComplete);
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const completeChecklistStep = useAppStore(s => s.completeChecklistStep);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const deviceInfo = useAppStore(s => s.deviceInfo);
  // Hidden once the user dismisses it, or once Pro is active (the upsell makes no
  // sense to a paid user). hasRegisteredPro only flips true after RC verification
  // (activateProByEmail / revalidatePro), so this also covers "paid and verified".
  const devProDisabled = useAppStore(s => s.devProDisabled);
  const setDevProDisabled = useAppStore(s => s.setDevProDisabled);
  const setHasRegisteredPro = useAppStore(s => s.setHasRegisteredPro);
  const { proStatusLabel } = useProStatusLabel();

  useEffect(() => {
    completeChecklistStep('exploredSettings');
  }, [completeChecklistStep]);

  const handleSendFeedback = async () => {
    const { downloadedModels } = useAppStore.getState();
    const activeModelId = activeLocalModelId('text');
    const activeServerId = activeMobileRoute('text').model?.serverId ?? null;

    const fsInfo = await RNFS.getFSInfo();

    const ramGB = hardwareService.getTotalMemoryGB().toFixed(1);
    const tier = hardwareService.getDeviceTier();
    const freeGB = (fsInfo.freeSpace / (1024 * 1024 * 1024)).toFixed(1);
    const activeModel = downloadedModels.find(m => m.id === activeModelId);
    const modelLine = activeModel ? activeModel.fileName : 'None';
    const remoteServer = activeServerId ? 'Yes' : 'No';
    const deviceLine = deviceInfo
      ? `Device: ${deviceInfo.deviceModel} (${deviceInfo.systemName} ${deviceInfo.systemVersion})`
      : 'Device: Unknown';

    const subject = `[Feedback] Off Grid AI v${appVersion()}`;
    const body =
      `Hi,\n\n[Describe your feedback or issue here]\n\n` +
        `---\n` +
        `App: ${appBuildLabel()}\n` +
        `${deviceLine}\n` +
        `RAM: ${ramGB} GB · Tier: ${tier}\n` +
        `Model: ${modelLine}\n` +
        `Free storage: ${freeGB} GB\n` +
        `Remote server: ${remoteServer}`;
    await openSupportEmail({ subject, body });
  };

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
      }),
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Settings" variant="tab" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {/* PRO Banner */}
        <ProUpsellBanner
          trigger={focusTrigger}
          onGetPro={() => navigation.navigate('ProDetail')}
        />

        <SettingsAppearanceRow
          focusTrigger={focusTrigger}
          styles={styles}
          colors={colors}
          themeMode={themeMode}
          onSelect={setThemeMode}
        />

        {/* Navigation Items */}
          <View style={styles.navSection}>
            {[
              {
                icon: 'sliders',
                title: 'Model Settings',
                desc: 'System prompt, generation, and performance',
                screen: 'ModelSettings' as const,
                testID: 'open-model-settings',
              },
              {
                icon: 'wifi',
                title: 'Remote Servers',
                desc: 'Connect to Off Grid AI Desktop, Ollama, LM Studio, and more',
                screen: 'RemoteServers' as const,
              },
              ...(hasSync
                ? [
                    {
                      icon: 'refresh-cw',
                      title: isSyncUnlocked ? 'Sync' : 'Sync with Pro',
                      desc: isSyncUnlocked
                        ? 'Chats, projects, files, and copied text across your devices'
                        : 'Get Pro to set up encrypted Sync across your devices',
                      screen: 'Sync' as const,
                      testID: 'open-sync-settings',
                    },
                  ]
                : []),
              //  { icon: 'search', title: 'Web Search', desc: 'Configure search API key for reliable results', screen: 'WebSearchSettings' as const },
              {
                icon: 'lock',
                title: 'Security',
                desc: 'Passphrase and app lock',
                screen: 'SecuritySettings' as const,
              },
              {
                icon: 'smartphone',
                title: 'Device Information',
                desc: 'Hardware and compatibility',
                screen: 'DeviceInfo' as const,
              },
              {
                icon: 'hard-drive',
                title: 'Storage',
                desc: 'Models and data usage',
                screen: 'StorageSettings' as const,
              },
            ].map((item, index, arr) => (
              <AnimatedListItem
                key={item.screen}
                index={index + 1}
                staggerMs={40}
                trigger={focusTrigger}
                style={[
                  styles.navItem,
                  index === arr.length - 1 && styles.navItemLast,
                ]}
                onPress={() =>
                  item.screen === 'Sync'
                    ? openSync()
                    : navigation.navigate(item.screen)
                }
                testID={'testID' in item ? item.testID : undefined}
              >
                <View style={styles.navItemIcon}>
                  <Icon
                    name={item.icon}
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
                <View style={styles.navItemContent}>
                  <Text style={styles.navItemTitle}>{item.title}</Text>
                  <Text style={styles.navItemDesc}>{item.desc}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </AnimatedListItem>
            ))}
          </View>

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

        <SettingsCommunitySections
          focusTrigger={focusTrigger}
          styles={styles}
          colors={colors}
          onSendFeedback={handleSendFeedback}
        />

        {/* About */}
        <AnimatedEntry index={9} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.navSection}>
            <TouchableOpacity
              style={[styles.navItem, styles.navItemLast]}
              onPress={() => navigation.navigate('About')}
            >
              <View style={styles.navItemIcon}>
                <Icon name="info" size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>About</Text>
                <Text style={styles.navItemDesc}>
                  Version {appVersion()}
                </Text>
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
        {settingsSections.map((Section, i) => (
          <Section key={Section.displayName ?? String(i)} />
        ))}

        {/* Dev-only tooling — stripped from release builds */}
        {__DEV__ && (
          <AnimatedEntry index={11} staggerMs={40} trigger={focusTrigger}>
            <View style={styles.devButtonGroup}>
              <TouchableOpacity
                style={styles.devButton}
                onPress={handleResetOnboarding}
              >
                <Icon name="rotate-ccw" size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>Reset Onboarding</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.devButton}
                onPress={() => setShowDebugLogs(true)}
              >
                <Icon name="terminal" size={14} color={colors.textMuted} />
                <Text style={styles.devButtonText}>Debug Logs</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.devButton}
                onPress={handleToggleDevPro}
              >
                <Icon
                  name={devProDisabled ? 'unlock' : 'lock'}
                  size={14}
                  color={colors.textMuted}
                />
                <Text style={styles.devButtonText}>
                  {devProDisabled ? 'Turn on Pro (DEV)' : 'Turn off Pro (DEV)'}
                </Text>
              </TouchableOpacity>
            </View>
          </AnimatedEntry>
        )}

        <MadeWithLove />
        {__DEV__ && (
          <DebugLogsScreen
            visible={showDebugLogs}
            onClose={() => setShowDebugLogs(false)}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
