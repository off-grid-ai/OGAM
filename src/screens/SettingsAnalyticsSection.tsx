import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Switch, TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { DebugLogsScreen } from '../components/DebugLogsScreen';
import { useAppStore } from '../stores/appStore';
import { setAnalyticsConsent } from '../services/analytics/analytics';
import { sendProblemReport } from '../services/problemReport';
import { ignore } from '../services/analytics/values';
import type { ThemeColors } from '../theme';
import type { createStyles } from './SettingsScreen.styles';

interface SettingsAnalyticsSectionProps {
  focusTrigger: number;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
  onWhatWeShare: () => void;
}

/** Settings → Analytics: the two consent toggles, what is shared, and Report a problem. */
export const SettingsAnalyticsSection: React.FC<SettingsAnalyticsSectionProps> = ({
  focusTrigger,
  styles,
  colors,
  onWhatWeShare,
}) => {
  const usage = useAppStore(s => s.settings.analyticsUsage);
  const crashes = useAppStore(s => s.settings.analyticsCrashes);
  const [showLog, setShowLog] = useState(false);

  // Each toggle carries an icon so its words line up with the rows below.
  const toggle = (label: string, icon: string, value: boolean, onChange: (next: boolean) => void) => (
    <View style={styles.navItem}>
      <View style={styles.navItemIcon}>
        <Icon name={icon} size={16} color={colors.textSecondary} />
      </View>
      <View style={styles.navItemContent}>
        <Text style={styles.navItemTitle}>{label}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceLight, true: `${colors.primary}80` }}
        thumbColor={value ? colors.primary : colors.textMuted}
      />
    </View>
  );

  return (
    <AnimatedEntry index={10} staggerMs={40} trigger={focusTrigger}>
      <Text style={styles.sectionLabel}>Analytics</Text>
      <View style={styles.navSection} testID="settings-analytics">
        {toggle('Anonymous stats', 'bar-chart-2', usage, next => {
          setAnalyticsConsent({ usage: next }, 'settings').catch(ignore);
        })}
        {toggle('Crash reports', 'activity', crashes, next => {
          setAnalyticsConsent({ crashes: next }, 'settings').catch(ignore);
        })}
        <TouchableOpacity style={styles.navItem} onPress={onWhatWeShare} testID="settings-what-we-share">
          <View style={styles.navItemIcon}>
            <Icon name="eye" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>What we share</Text>
            <Text style={styles.navItemDesc}>Your chats and files never leave your device</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navItem, styles.navItemLast]}
          onPress={() => setShowLog(true)}
          testID="settings-report-problem"
        >
          <View style={styles.navItemIcon}>
            <Icon name="alert-circle" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Report a problem</Text>
            <Text style={styles.navItemDesc}>Check the debug log, then send it to us</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      {showLog ? (
        <DebugLogsScreen
          visible
          onClose={() => setShowLog(false)}
          onSend={() => {
            sendProblemReport().catch(ignore);
          }}
        />
      ) : null}
    </AnimatedEntry>
  );
};
