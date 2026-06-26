/**
 * ProManageSection
 *
 * Shown on the Pro screen when Pro is active. Surfaces subscription status from
 * the cached Keygen license (lifetime vs monthly + expiry) and the registered
 * devices (N of 5). The device list is read-only on purpose: the 5-device cap is
 * a hard limit and there is no self-service removal — letting users free slots
 * would let a single key cycle through unlimited devices and defeat the cap.
 * For monthly licenses it explains how to cancel or update payment: via the
 * link RevenueCat emails with every purchase and renewal. There is no in-app
 * portal because RevenueCat authenticates Web Billing customers by email.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import {
  getProLicenseInfo,
  listProDevices,
  type ProLicenseInfo,
} from '../../services/proLicenseService';
import { getDeviceFingerprint } from '../../services/deviceFingerprint';
import type { KeygenMachine } from '../../services/keygenClient';
import logger from '../../utils/logger';

const MAX_DEVICES = 5;

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export const ProManageSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [info, setInfo] = useState<ProLicenseInfo | null>(null);
  const [devices, setDevices] = useState<KeygenMachine[]>([]);
  const [thisFingerprint, setThisFingerprint] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [licenseInfo, fingerprint] = await Promise.all([getProLicenseInfo(), getDeviceFingerprint()]);
      setInfo(licenseInfo);
      setThisFingerprint(fingerprint);
      setDevices(await listProDevices());
    } catch (e) {
      logger.error('[ProManage] load failed:', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const statusLine = !info
    ? ''
    : info.tier === 'lifetime'
      ? 'Lifetime · never expires'
      : info.tier === 'monthly'
        ? `Monthly · active until ${formatDate(info.expiry)}`
        : '';

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Icon name="check-circle" size={18} color={colors.primary} />
        <Text style={styles.statusText}>{statusLine}</Text>
      </View>

      <Text style={styles.sectionLabel}>Devices ({devices.length} of {MAX_DEVICES})</Text>
      <Text style={styles.capHint}>
        A license works on up to {MAX_DEVICES} devices. This limit is fixed.
      </Text>
      {devices.map((machine) => {
        const isThisDevice = machine.fingerprint === thisFingerprint;
        return (
          <View key={machine.id} style={styles.deviceRow}>
            <Icon name="smartphone" size={14} color={colors.textMuted} />
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName} numberOfLines={1}>
                {machine.name || machine.platform || 'Device'}
                {isThisDevice ? ' · This device' : ''}
              </Text>
              {machine.lastSeen ? <Text style={styles.deviceMeta}>Added {formatDate(machine.lastSeen)}</Text> : null}
            </View>
          </View>
        );
      })}

      {info?.tier === 'monthly' ? (
        <View style={styles.manageBlock}>
          <Text style={styles.sectionLabel}>Manage subscription</Text>
          <View style={styles.manageRow}>
            <Icon name="mail" size={14} color={colors.textMuted} />
            <Text style={styles.manageHint}>
              To cancel or update your payment method, use the link in your Off Grid purchase or
              renewal email. RevenueCat sends one with every payment.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) =>
  ({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.lg,
      marginHorizontal: SPACING.xl,
      marginBottom: SPACING.xl,
      gap: SPACING.sm as number,
      ...shadows.small,
    },
    statusRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
    },
    statusText: { ...TYPOGRAPHY.body, color: colors.text },
    sectionLabel: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.textMuted,
      letterSpacing: 0.3,
      marginTop: SPACING.sm,
    },
    capHint: { ...TYPOGRAPHY.meta, color: colors.textMuted },
    deviceRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    deviceInfo: { flex: 1, gap: 2 as number },
    deviceName: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    deviceMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
    manageBlock: {
      marginTop: SPACING.sm,
      gap: SPACING.sm as number,
    },
    manageRow: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: SPACING.md,
    },
    manageHint: { ...TYPOGRAPHY.meta, color: colors.textMuted, flex: 1 },
  });
