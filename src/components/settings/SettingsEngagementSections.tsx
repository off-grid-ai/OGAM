import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import packageJson from '../../../package.json';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { hardwareService } from '../../services';
import { useAppStore, useRemoteServerStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { openExternalUrl } from '../../utils/externalLinks';
import {
  FOLLOW_X_URL,
  GITHUB_URL,
  shareOnX,
  SLACK_INVITE_URL,
} from '../../utils/sharePrompt';

const FEEDBACK_EMAIL = 'support@offgridmobileai.co';

async function sendFeedback(): Promise<void> {
  const { downloadedModels, activeModelId, deviceInfo } =
    useAppStore.getState();
  const { activeServerId } = useRemoteServerStore.getState();
  const [buildNumber, fsInfo] = await Promise.all([
    DeviceInfo.getBuildNumber(),
    RNFS.getFSInfo(),
  ]);
  const activeModel = downloadedModels.find(
    model => model.id === activeModelId,
  );
  const deviceLine = deviceInfo
    ? `Device: ${deviceInfo.deviceModel} (${deviceInfo.systemName} ${deviceInfo.systemVersion})`
    : 'Device: Unknown';
  const subject = encodeURIComponent(
    `[Feedback] Off Grid AI v${packageJson.version}`,
  );
  const body = encodeURIComponent(
    `Hi,\n\n[Describe your feedback or issue here]\n\n` +
      `---\n` +
      `App: v${packageJson.version} (build ${buildNumber})\n` +
      `${deviceLine}\n` +
      `RAM: ${hardwareService
        .getTotalMemoryGB()
        .toFixed(1)} GB · Tier: ${hardwareService.getDeviceTier()}\n` +
      `Model: ${activeModel?.fileName ?? 'None'}\n` +
      `Free storage: ${(fsInfo.freeSpace / (1024 * 1024 * 1024)).toFixed(
        1,
      )} GB\n` +
      `Remote server: ${activeServerId ? 'Yes' : 'No'}`,
  );

  await openExternalUrl(
    `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`,
    {
      label: 'mail app',
      fallback: `Email ${FEEDBACK_EMAIL} directly.`,
    },
  );
}

export const SettingsEngagementSections: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <>
      <View style={styles.followSection}>
        <View style={styles.followHeader}>
          <Text style={styles.followHeaderTitle}>Stay in the loop</Text>
          <Text style={styles.followHeaderDesc}>
            New features land here first, subscribers get promo discounts, and
            your feedback shapes what gets built next.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.navItem}
          testID="follow-on-x"
          onPress={() =>
            openExternalUrl(FOLLOW_X_URL, {
              label: 'X profile',
              fallback: 'Open x.com/alichherawalla in your browser.',
            })
          }
        >
          <View style={styles.followItemIcon}>
            <Icon name="twitter" size={16} color={colors.primary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Follow @alichherawalla on X</Text>
            <Text style={styles.navItemDesc}>
              Feature drops, promo discounts, roadmap
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navItem, styles.navItemLast]}
          testID="join-slack"
          onPress={() =>
            openExternalUrl(SLACK_INVITE_URL, {
              label: 'Slack invite',
              fallback: 'Try again after checking your browser settings.',
            })
          }
        >
          <View style={styles.followItemIcon}>
            <IconMC name="slack" size={16} color={colors.primary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Join the Slack community</Text>
            <Text style={styles.navItemDesc}>
              Issues fixed fast, debug together, early access
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.navSection}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() =>
            openExternalUrl(GITHUB_URL, {
              label: 'GitHub page',
              fallback: 'Open github.com/off-grid-ai/mobile in your browser.',
            })
          }
        >
          <View style={styles.navItemIcon}>
            <Icon name="star" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Star on GitHub</Text>
            <Text style={styles.navItemDesc}>
              Support the open-source project
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={sendFeedback}>
          <View style={styles.navItemIcon}>
            <Icon name="mail" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Send Feedback</Text>
            <Text style={styles.navItemDesc}>
              Report a bug or share a suggestion
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navItem, styles.navItemLast]}
          onPress={shareOnX}
        >
          <View style={styles.navItemIcon}>
            <Icon name="share-2" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>Share on X</Text>
            <Text style={styles.navItemDesc}>
              Tell others about Off Grid AI
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
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
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  navItemContent: { flex: 1 },
  navItemTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  navItemDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  followSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    ...shadows.small,
  },
  followHeader: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  followHeaderTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.primary,
  },
  followHeaderDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
    lineHeight: 18,
  },
  followItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
});
