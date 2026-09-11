import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import {
  projectPersonalMeshActivationFailure,
  type PersonalMeshActivationFailureProjection,
} from '@offgrid/application';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import {
  activateProByKey,
  PRO_PAY_PAGE_URL,
} from '../../services/proLicenseService';
import { withUtm } from '../../utils/utm';
import { AppSheet } from '../../components/AppSheet';

type ErrorMsg = Pick<
  PersonalMeshActivationFailureProjection,
  'title' | 'description'
> | null;

type Props = {
  visible: boolean;
  onClose: () => void;
  onUnlocked: () => void;
};

// Activation sheet: the user pastes the license key from their email and we
// activate it on this device. Paying is a separate path — "Get Pro" opens the
// web pay page; the buyer is then emailed a key to paste here.
export const ProUnlockModal: React.FC<Props> = ({
  visible,
  onClose,
  onUnlocked,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorMsg>(null);
  const [success, setSuccess] = useState(false);

  // The modal stays mounted across opens, so clear transient state each time it
  // opens so a previous attempt's key/error never leaks into a fresh open.
  useEffect(() => {
    if (visible) {
      setLicenseKey('');
      setError(null);
      setSuccess(false);
      setLoading(false);
    }
  }, [visible]);

  const close = () => {
    if (loading || success) return;
    setLicenseKey('');
    setError(null);
    onClose();
  };

  // Dismiss the success card once the user has read it. The keychain write is
  // already done at this point; Pro features load on the next app launch.
  const finishSuccess = () => {
    setLicenseKey('');
    setError(null);
    setSuccess(false);
    onClose();
  };

  const clearError = () => {
    if (error) setError(null);
  };

  const handleActivate = async () => {
    const trimmed = licenseKey.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const res = await activateProByKey(trimmed);
      if (res.ok) {
        setSuccess(true);
        onUnlocked();
      } else {
        setError(projectPersonalMeshActivationFailure(res.reason));
      }
    } catch {
      setError(projectPersonalMeshActivationFailure('registration_failed'));
    } finally {
      setLoading(false);
    }
  };

  // Not a member yet — send them to the web pay page. The buyer's key is emailed
  // to them after checkout, then pasted here.
  const handleGetPro = () => {
    Linking.openURL(withUtm(PRO_PAY_PAGE_URL, 'pro-unlock')).catch(() => {
      setError({
        title: 'Could not open Pro',
        description: 'Please try again.',
      });
    });
  };

  const hasInput = licenseKey.trim().length > 0;
  // Activation owns this sheet until it reaches a terminal state. A parent
  // entitlement refresh can clear `visible` while the request is still in
  // flight; keep the progress and success result on screen until the person
  // dismisses them.
  const sheetVisible = visible || loading || success;

  return (
    <AppSheet
      visible={sheetVisible}
      onClose={success ? finishSuccess : close}
      onHeaderClosePress={success ? finishSuccess : close}
      dismissible={!loading}
      enableDynamicSizing
      title={success ? 'Pro activated' : 'Enter your license key'}
      closeLabel={success ? 'Done' : 'Cancel'}
    >
      <View style={styles.content}>
        {success ? (
          <>
            <View style={styles.successIconWrap}>
              <Icon name="check" size={26} color={colors.primary} />
            </View>
            <Text style={styles.successSub}>Pro is active on this device.</Text>
            <TouchableOpacity
              style={styles.successBtn}
              onPress={finishSuccess}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Paste the license key from your email. It works on your licensed
              devices.
            </Text>

            {/* License key input */}
            <TextInput
              style={styles.input}
              placeholder="key/..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              value={licenseKey}
              onChangeText={t => {
                setLicenseKey(t);
                clearError();
              }}
              editable={!loading}
              testID="license-key-input"
            />

            {/* Inline error */}
            {error ? (
              <View style={styles.errorBlock}>
                <Text style={styles.errorTitle}>{error.title}</Text>
                <Text style={styles.errorText}>{error.description}</Text>
              </View>
            ) : null}

            {/* Primary CTA */}
            <TouchableOpacity
              testID="unlock-cta"
              style={[
                styles.primaryBtn,
                (loading || !hasInput) && styles.disabled,
              ]}
              onPress={handleActivate}
              disabled={loading || !hasInput}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {loading ? 'Activating...' : 'Activate'}
              </Text>
            </TouchableOpacity>

            {/* Footer — not a member yet, go to the pay page */}
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={handleGetPro}
              disabled={loading}
            >
              <Text style={styles.toggleText}>Not a member yet? Get Pro</Text>
              <Icon
                name="external-link"
                size={13}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </>
        )}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },

  input: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xs,
    minHeight: 48,
  },

  errorBlock: {
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  errorTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: '#E05252',
    marginBottom: SPACING.xs,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '400' as const,
    color: '#E05252',
    lineHeight: 18,
  },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  toggleText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },

  disabled: {
    opacity: 0.5,
  },

  // Success state
  successIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    alignSelf: 'center' as const,
    marginBottom: SPACING.lg,
  },
  successSub: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  successBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    alignSelf: 'stretch' as const,
    marginTop: SPACING.xl,
  },
});
