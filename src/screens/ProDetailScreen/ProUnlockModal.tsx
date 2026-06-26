import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { activateProByKey, PRO_PAY_PAGE_URL, type ActivateResult } from '../../services/proLicenseService';

type ErrorMsg = string | null;

type Props = {
  visible: boolean;
  onClose: () => void;
  onUnlocked: () => void;
};

function messageFor(reason: Extract<ActivateResult, { ok: false }>['reason']): string {
  switch (reason) {
    case 'limit':
      return 'This key is already on its 5 devices. Remove one on a device where Pro is active, then try again.';
    case 'network':
      return 'Could not reach the licensing server. Check your connection and try again.';
    default:
      return "That license key isn't valid or active. Check it and try again.";
  }
}

// Activation modal: the user pastes the license key from their email and we
// activate it on this device. Paying is a separate path — "Get Pro" opens the
// web pay page; the buyer is then emailed a key to paste here.
export const ProUnlockModal: React.FC<Props> = ({ visible, onClose, onUnlocked }) => {
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

  const clearError = () => { if (error) setError(null); };

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
        setError(messageFor(res.reason));
      }
    } catch {
      setError('Activation failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Not a member yet — send them to the web pay page. The buyer's key is emailed
  // to them after checkout, then pasted here.
  const handleGetPro = () => {
    Linking.openURL(PRO_PAY_PAGE_URL).catch(() => {
      setError('Could not open the Pro page. Please try again.');
    });
  };

  if (success) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={finishSuccess}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.successIconWrap}>
              <Icon name="check" size={26} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>Pro activated</Text>
            <Text style={styles.successSub}>You're all set. Pro is active on this device.</Text>
            <TouchableOpacity style={styles.successBtn} onPress={finishSuccess} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const hasInput = licenseKey.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Tap the dimmed area to dismiss the keyboard */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.dismissArea} />
        </TouchableWithoutFeedback>
        <View style={styles.card}>

          {/* Close X */}
          <TouchableOpacity style={styles.closeBtn} onPress={close} disabled={loading} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="x" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Header */}
          <Text style={styles.title}>Enter your license key</Text>
          <Text style={styles.subtitle}>
            Paste the license key from your email. It works on up to 5 devices.
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
            onChangeText={(t) => { setLicenseKey(t); clearError(); }}
            editable={!loading}
            testID="license-key-input"
          />

          {/* Inline error */}
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {/* Primary CTA */}
          <TouchableOpacity
            testID="unlock-cta"
            style={[styles.primaryBtn, (loading || !hasInput) && styles.disabled]}
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
            <Icon name="external-link" size={13} color={colors.textSecondary} />
          </TouchableOpacity>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xl,
  },
  dismissArea: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    ...shadows.small,
  },

  closeBtn: {
    alignSelf: 'flex-end' as const,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },

  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.xs,
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

  errorText: {
    fontSize: 13,
    fontWeight: '400' as const,
    color: '#E05252',
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
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
  successTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.sm,
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
