import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { TouchableOpacity, Switch } from '../components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores/appStore';
import {
  checkEngineUpdatesNow,
  getEngineUpdateInfo,
  type EngineCheckOutcome,
  type EngineUpdateInfo,
} from '../services/enginePacks';

const CHECK_RESULT: Record<EngineCheckOutcome, string> = {
  staged: 'A newer engine is ready. It switches on the next time you open Off Grid AI.',
  current: 'You have the newest engine.',
  failed: 'Could not check right now. Check your connection and try again.',
  off: 'Turn on engine updates to check.',
  unsupported: '',
};

function engineName(info: EngineUpdateInfo): string {
  const build = info.llamaBuild ? `llama.cpp b${info.llamaBuild}` : 'llama.cpp';
  return info.version ? `${build} · v${info.version}` : build;
}

function lastChecked(at: number | null): string {
  if (!at) return 'Not checked yet';
  return `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))}`;
}

/** Settings → Engine updates: whether Off Grid AI takes newer engines without an app update. */
export const EngineUpdatesScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const enabled = useAppStore(state => state.settings.engineUpdates);
  const updateSettings = useAppStore(state => state.updateSettings);
  const [info, setInfo] = useState<EngineUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState('');

  const refresh = useCallback(() => getEngineUpdateInfo().then(setInfo), []);
  useEffect(() => { refresh(); }, [refresh]);

  const checkNow = async () => {
    setChecking(true);
    setResult('');
    const outcome = await checkEngineUpdatesNow();
    setChecking(false);
    setResult(CHECK_RESULT[outcome]);
    refresh();
  };

  const overTheAir = info?.path === 'over-the-air';
  const packInUse = info?.source === 'pack';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Engine updates</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {info && overTheAir ? (
          <Card style={styles.section}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Automatic engine updates</Text>
                <Text style={styles.settingHint}>
                  Off Grid AI gets faster engines and support for new models without an app update. They download in
                  the background and switch on the next time you open the app.
                </Text>
              </View>
              <Switch
                testID="engine-updates-switch"
                accessibilityLabel="Automatic engine updates"
                value={enabled}
                onValueChange={value => { updateSettings({ engineUpdates: value }); setResult(''); }}
                trackColor={{ false: colors.surfaceLight, true: `${colors.primary}80` }}
                thumbColor={enabled ? colors.primary : colors.textMuted}
              />
            </View>
            {!enabled ? (
              <Text style={styles.status} testID="engine-updates-off">
                {packInUse
                  ? 'Engine updates are off. Nothing new downloads or installs. The engine update you already have stays in use.'
                  : 'Engine updates are off. Nothing downloads or installs until you turn this back on.'}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {info ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Running now</Text>
            <Text style={styles.settingLabel} testID="engine-running">{engineName(info)}</Text>
            <Text style={styles.settingHint} testID="engine-source">
              {packInUse ? 'Engine update, installed without an app update' : 'Built into this version of the app'}
            </Text>
            {overTheAir ? (
              <>
                <Text style={styles.settingHint} testID="engine-last-check">{lastChecked(info.lastCheck)}</Text>
                <Button
                  title={checking ? 'Checking...' : 'Check now'}
                  variant="primary"
                  size="medium"
                  onPress={checkNow}
                  disabled={checking || !enabled}
                  testID="engine-check-now"
                  icon={<Icon name="refresh-cw" size={16} color={colors.primary} />}
                  style={styles.checkButton}
                />
                {result ? <Text style={styles.status} testID="engine-check-result">{result}</Text> : null}
              </>
            ) : null}
          </Card>
        ) : null}

        {info && !overTheAir ? (
          <Card style={styles.infoCard}>
            <Icon name="info" size={18} color={colors.textMuted} />
            <Text style={styles.infoText} testID="engine-updates-with-app">
              On iPhone, engines update with Off Grid AI. Update the app from the App Store to get the newest engine
              and support for new models.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
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
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  section: { marginBottom: SPACING.lg },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  settingRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: SPACING.md },
  settingInfo: { flex: 1 },
  settingLabel: { ...TYPOGRAPHY.body, color: colors.text },
  settingHint: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  status: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginTop: SPACING.md, lineHeight: 18 },
  checkButton: { alignSelf: 'flex-start' as const, marginTop: SPACING.lg },
  infoCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: { ...TYPOGRAPHY.bodySmall, flex: 1, color: colors.textMuted, lineHeight: 18 },
});
