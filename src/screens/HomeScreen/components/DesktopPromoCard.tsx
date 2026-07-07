import React from 'react';
import { View, Text, TouchableOpacity, Linking, Clipboard } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useThemedStyles, useTheme } from '../../../theme';
import { createStyles } from '../styles';
import { useAppStore } from '../../../stores';
import { OFF_GRID_DESKTOP_URL } from '../../../constants';
import { withUtm } from '../../../utils/utm';

const DESKTOP_URL = withUtm(OFF_GRID_DESKTOP_URL, 'home-promo');

/**
 * Off Grid AI Desktop promo card on Home — announces the desktop app is live.
 * Owns its own copied-link state so the parent screen stays simple. Tapping the
 * card opens the download page; the X dismisses it (persisted in appStore);
 * "Copy link" copies the URL for sharing (people see this on a phone but install
 * on a Mac, so they paste it into WhatsApp/Slack to open on a desktop later).
 */
export const DesktopPromoCard: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const desktopPromoDismissed = useAppStore((s) => s.desktopPromoDismissed);
  const setDesktopPromoDismissed = useAppStore((s) => s.setDesktopPromoDismissed);
  const [linkCopied, setLinkCopied] = React.useState(false);

  const copyLink = React.useCallback(() => {
    Clipboard.setString(DESKTOP_URL);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, []);

  if (desktopPromoDismissed) return null;

  return (
    <AnimatedPressable
      style={styles.desktopCard}
      onPress={() => Linking.openURL(DESKTOP_URL)}
      hapticType="selection"
      testID="desktop-promo-card"
    >
      <View style={styles.desktopCardHeader}>
        <Icon name="monitor" size={18} color={colors.primary} />
        <Text style={styles.desktopCardTitle}>Off Grid AI Desktop</Text>
        <View style={styles.desktopBadge}>
          <Text style={styles.desktopBadgeText}>Live</Text>
        </View>
        <TouchableOpacity
          onPress={() => setDesktopPromoDismissed(true)}
          hitSlop={10}
          testID="desktop-promo-dismiss"
        >
          <Icon name="x" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.desktopCardBody}>
        Chat, image, voice, and projects that answer from your own docs - on your Mac, on-device. Plus a private layer that remembers what you see, rewinds your day, searches it all at once, and drafts to-dos and actions you approve. Nothing leaves the device.
      </Text>
      <View style={styles.desktopCardCtaRow}>
        <View style={styles.desktopCardCta}>
          <Text style={styles.desktopCardCtaText}>Get it for macOS</Text>
          <Icon name="arrow-up-right" size={14} color={colors.primary} />
        </View>
        <TouchableOpacity
          style={styles.desktopCardCopy}
          onPress={copyLink}
          hitSlop={10}
          testID="desktop-promo-copy"
        >
          <Icon name={linkCopied ? 'check' : 'copy'} size={14} color={colors.textSecondary} />
          <Text style={styles.desktopCardCopyText}>
            {linkCopied ? 'Link copied' : 'Copy link'}
          </Text>
        </TouchableOpacity>
      </View>
    </AnimatedPressable>
  );
};
