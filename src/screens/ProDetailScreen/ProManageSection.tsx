/**
 * ProManageSection
 *
 * Shown on the Pro screen when a protected credential is saved. Surfaces
 * subscription status from the cached license tier and expiry.
 * Active licensed
 * devices are managed from the Pro-owned Sync screen, so there is one list and
 * one action owner rather than a second read-only copy here.
 * For a recurring license it explains how to cancel or update payment:
 * via the link RevenueCat emails with every purchase and renewal. There is no
 * in-app portal because RevenueCat authenticates Web Billing customers by email.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Alert,
} from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { LoadingDots } from '../../components/LoadingDots';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { useHasRegisteredScreen } from '../../navigation/screenRegistry';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import {
  getProLicenseInfo,
  resetProOnThisDevice,
  PRO_TIER_META,
  type ProLicenseInfo,
} from '../../services/proLicenseService';
import { loadProFeatures } from '../../bootstrap/loadProFeatures';
import logger from '../../utils/logger';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export const ProManageSection: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasSyncScreen = useHasRegisteredScreen('Sync');
  const [info, setInfo] = useState<ProLicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  // Answers whether the card now shows current state. It swallows its own failure so first paint can
  // never reject, which also meant a caller could not tell a repaint from a silent miss - and after a
  // reset that difference is the whole message.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      setInfo(await getProLicenseInfo());
      return true;
    } catch (e) {
      logger.error('[ProManage] load failed:', e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Confirmed first, because it releases a seat on the licence rather than only clearing this phone.
  // The failure branch matters: resetProOnThisDevice returns false when the seat could NOT be
  // released, and it keeps the credential in that case. Telling the user it worked would leave them
  // entering a new key on a device the licence still counts.
  const confirmReset = useCallback(() => {
    Alert.alert(
      'Reset Pro on this phone?',
      'This removes this phone from the saved licence so it can use a different one. Your other devices stay active.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Pro',
          style: 'destructive',
          onPress: () => {
            setResetting(true);
            resetProOnThisDevice()
              .then(async ok => {
                if (!ok) {
                  Alert.alert(
                    'Could not reset Pro',
                    'The licence could not be reached, so this phone still holds its seat. Check your connection and try again.',
                  );
                  return;
                }
                // The seat IS released and the credential IS gone by this point, so a failure here is
                // not a failed reset - it is a screen that could not catch up. Swallowing it left the
                // card showing a licence the phone no longer has, which reads as "reset did nothing"
                // and invites a second attempt on a device that has already been reset.
                let repainted = false;
                try {
                  await loadProFeatures();
                  repainted = await refresh();
                } catch (e) {
                  logger.error(`[Pro] reset reload failed: ${String(e)}`);
                }
                // Covers both ways the card can be left behind: loadProFeatures throwing, and refresh
                // failing to read the new state - which it reports rather than throws.
                if (!repainted) {
                  Alert.alert(
                    'Pro was reset',
                    'This phone no longer holds the licence. Pro features are now locked.',
                  );
                }
              })
              // The reset itself threw, so whether the seat was released is unknown. Say so rather
              // than only writing to a log the user cannot read.
              .catch(e => {
                logger.error(`[Pro] reset failed: ${String(e)}`);
                Alert.alert(
                  'Could not reset Pro',
                  'Something went wrong, so this phone may still hold its seat. Try again.',
                );
              })
              .finally(() => setResetting(false));
          },
        },
      ],
    );
  }, [refresh]);

  // Render from the tier's own semantics (PRO_TIER_META), not a per-tier branch: a
  // recurring tier shows its renewal date, a one-time tier says it never expires.
  const tierMeta = info?.tier ? PRO_TIER_META[info.tier] : null;
  const statusLine = !tierMeta
    ? ''
    : tierMeta.renews
      ? `${tierMeta.label} · renews ${formatDate(info!.expiry)}`
      : `${tierMeta.label} · never expires`;

  if (loading) {
    return (
      <View style={styles.card}>
        <LoadingDots color={colors.primary} />
      </View>
    );
  }

  const renewing = tierMeta?.renews === true;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Your licence</Text>
      <View style={[styles.row, hasSyncScreen || renewing ? null : styles.lastRow]}>
        <Icon name="check-circle" size={18} color={colors.primary} />
        <Text style={styles.rowTitle}>{statusLine}</Text>
      </View>

      {hasSyncScreen ? (
        <TouchableOpacity
          style={[styles.row, renewing ? null : styles.lastRow]}
          activeOpacity={0.72}
          onPress={() => navigation.navigate('Sync')}
          accessibilityRole="button"
          accessibilityLabel="Manage licensed devices in Sync"
        >
          <Icon name="monitor" size={18} color={colors.primary} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Licensed devices</Text>
            <Text style={styles.rowDescription}>View or deactivate from Sync</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}

      {/* Web Billing authenticates by email, so the only real path to cancelling is that link. */}
      {renewing ? (
        <View style={styles.row}>
          <Icon name="mail" size={18} color={colors.primary} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Manage subscription</Text>
            <Text style={styles.rowDescription}>
              Use the link in your renewal email to cancel or change payment.
            </Text>
          </View>
        </View>
      ) : null}

      {/* The desktop has carried this since it shipped; the phone had no equivalent, and the
          credential lives in the Keychain, which survives deleting the app. So a phone holding the
          wrong licence could not be moved onto the right one by any means available to its owner. */}
      <TouchableOpacity
        style={[styles.row, styles.lastRow]}
        activeOpacity={0.72}
        onPress={confirmReset}
        disabled={resetting}
        accessibilityRole="button"
        accessibilityLabel="Reset Pro on this phone"
      >
        <Icon name="rotate-ccw" size={18} color={colors.primary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>
            {resetting ? 'Resetting…' : 'Reset Pro'}
          </Text>
          <Text style={styles.rowDescription}>
            Remove the saved licence so this phone can use a different one.
          </Text>
        </View>
        {resetting ? <LoadingDots color={colors.primary} /> : null}
      </TouchableOpacity>
    </View>
  );
};

// The same card as the rest of the app: one surface, an uppercase title, hairline-divided rows.
const createStyles = (colors: ThemeColors, shadows: ThemeShadows) =>
  ({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      marginHorizontal: SPACING.xl,
      marginBottom: SPACING.xl,
      ...shadows.small,
    },
    cardTitle: {
      ...TYPOGRAPHY.label,
      color: colors.textMuted,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.3,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.xs,
    },
    row: {
      minHeight: 44,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.md,
      paddingVertical: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    lastRow: { borderBottomWidth: 0 },
    rowText: { flex: 1, gap: SPACING.xs },
    rowTitle: { ...TYPOGRAPHY.bodySmall, color: colors.text, flex: 1 },
    rowDescription: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  });
