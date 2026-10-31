import React from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { AnimatedEntry } from '../components/AnimatedEntry';
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

/**
 * The newsletter and community rows of the Settings screen.
 *
 * Split out because the screen's render was 452 lines against a 350-line cap - these two sections are
 * outbound links and nothing else, so they were the part that carried no screen state and could leave
 * without threading anything back.
 */
export const SettingsCommunitySections: React.FC<
  SettingsCommunitySectionsProps
> = ({ focusTrigger, styles, colors, onSendFeedback }) => (
  <>
    {/* Stay in the loop */}
    <AnimatedEntry index={7} staggerMs={40} trigger={focusTrigger}>
      <View style={styles.followSection}>
        <View style={styles.followHeader}>
          <Text style={styles.followHeaderTitle}>Stay in the loop</Text>
          <Text style={styles.followHeaderDesc}>
            New features land here first, subscribers get promo discounts,
            and your feedback shapes what gets built next.
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
            <Text style={styles.navItemTitle}>
              Follow @alichherawalla on X
            </Text>
            <Text style={styles.navItemDesc}>
              Feature drops, promo discounts, roadmap
            </Text>
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
            <Text style={styles.navItemTitle}>
              Join the Slack community
            </Text>
            <Text style={styles.navItemDesc}>
              Issues fixed fast, debug together, early access
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </AnimatedEntry>

    {/* Community */}
    <AnimatedEntry index={8} staggerMs={40} trigger={focusTrigger}>
      <View style={styles.navSection}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => Linking.openURL(GITHUB_URL)}
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
        <TouchableOpacity
          style={styles.navItem}
          onPress={onSendFeedback}
        >
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
          onPress={() => rateOnStore()}
        >
          <View style={styles.navItemIcon}>
            <Icon name="star" size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.navItemContent}>
            <Text style={styles.navItemTitle}>
              {Platform.OS === 'ios' ? 'Rate on the App Store' : 'Rate on Google Play'}
            </Text>
            <Text style={styles.navItemDesc}>
              A rating helps other people find Off Grid AI
            </Text>
          </View>
          <Icon name="external-link" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </AnimatedEntry>
  </>
);
