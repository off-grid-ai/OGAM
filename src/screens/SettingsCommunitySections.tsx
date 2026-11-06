import React from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { SectionLabel } from '../components/SectionLabel';
import {
  FOLLOW_X_URL,
  GITHUB_URL,
  SLACK_INVITE_URL,
  rateOnStore,
} from '../utils/sharePrompt';
import type { ThemeColors } from '../theme';
import type { createStyles } from './SettingsScreen.styles';

interface SettingsCommunitySectionsProps {
  focusTrigger: number;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
  onSendFeedback: () => void;
}

type CommunityRow = {
  key: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onPress: () => void;
  testID?: string;
};

/**
 * The community rows of the Settings screen: one labelled group (hand test 64 found two cards,
 * one with its own header paragraph, saying the same kind of thing).
 *
 * Split out because the screen's render was over its line cap. These rows are outbound links and
 * carry no screen state.
 */
export const SettingsCommunitySections: React.FC<
  SettingsCommunitySectionsProps
> = ({ focusTrigger, styles, colors, onSendFeedback }) => {
  const storeName = Platform.OS === 'ios' ? 'Rate on the App Store' : 'Rate on Google Play';
  const rows: CommunityRow[] = [
    { key: 'x', icon: <Icon name="at-sign" size={16} color={colors.textSecondary} />, title: 'Follow @alichherawalla on X', desc: 'New features first, promo discounts, the roadmap', onPress: () => Linking.openURL(FOLLOW_X_URL), testID: 'follow-on-x' },
    { key: 'slack', icon: <IconMC name="slack" size={16} color={colors.textSecondary} />, title: 'Join the Slack community', desc: 'Get help fast and try things early', onPress: () => Linking.openURL(SLACK_INVITE_URL), testID: 'join-slack' },
    { key: 'github', icon: <Icon name="star" size={16} color={colors.textSecondary} />, title: 'Star on GitHub', desc: 'Support the open-source project', onPress: () => Linking.openURL(GITHUB_URL) },
    { key: 'feedback', icon: <Icon name="mail" size={16} color={colors.textSecondary} />, title: 'Send feedback', desc: 'Report a bug or share an idea', onPress: onSendFeedback },
    { key: 'rate', icon: <Icon name="thumbs-up" size={16} color={colors.textSecondary} />, title: storeName, desc: 'A rating helps other people find Off Grid AI', onPress: () => rateOnStore() },
  ];
  return (
    <AnimatedEntry index={7} staggerMs={40} trigger={focusTrigger}>
      <SectionLabel title="Community" />
      <View style={styles.navSection}>
        {rows.map((row, i) => (
          <TouchableOpacity
            key={row.key}
            style={[styles.navItem, i === rows.length - 1 && styles.navItemLast]}
            testID={row.testID}
            onPress={row.onPress}
            accessibilityRole="button"
            accessibilityLabel={row.title}
          >
            <View style={styles.navItemIcon}>{row.icon}</View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>{row.title}</Text>
              <Text style={styles.navItemDesc}>{row.desc}</Text>
            </View>
            <Icon name="external-link" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </AnimatedEntry>
  );
};
