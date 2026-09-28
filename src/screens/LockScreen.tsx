import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button, CustomAlert } from '../components';
import {
  showAlert,
  hideAlert,
  initialAlertState,
  type AlertState,
} from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { mobileSecurity, useSecuritySnapshot } from '../services';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [passphrase, setPassphrase] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // The lock screen is a PASSPHRASE INPUT. Shared counts the attempts, decides when to lock the
  // person out, and unlocks; this screen carries what was typed and renders the answer.
  const security = useSecuritySnapshot();

  useEffect(() => {
    setLockoutSeconds(mobileSecurity.snapshot().lockoutRemainingSeconds);
    const interval = setInterval(
      () => setLockoutSeconds(mobileSecurity.snapshot().lockoutRemainingSeconds),
      1000,
    );
    return () => clearInterval(interval);
  }, [security.lockoutUntilMs]);

  const handleUnlock = useCallback(async () => {
    if (!passphrase.trim()) {
      setAlertState(showAlert('Error', 'Please enter your passphrase'));
      return;
    }
    setIsVerifying(true);
    try {
      const outcome = await mobileSecurity.unlock({ passphrase });
      setPassphrase('');
      if (outcome.ok) {
        onUnlock();
        return;
      }
      // The owner counts the attempts and decides when the wait starts; the screen reads its
      // newest numbers and says them in the words the person already knows.
      const after = mobileSecurity.snapshot();
      if (outcome.reason === 'locked_out' || after.lockedOut) {
        setAlertState(showAlert(
          'Too Many Attempts',
          'You have been locked out for 5 minutes due to too many failed attempts.',
        ));
        return;
      }
      const remaining = after.remainingAttempts;
      setAlertState(showAlert(
        'Incorrect Passphrase',
        remaining > 0
          ? `${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`
          : outcome.message,
      ));
    } finally {
      setIsVerifying(false);
    }
  }, [passphrase, onUnlock]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isLockedOut = security.lockedOut || lockoutSeconds > 0;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.lockIconContainer}>
            <Icon name="lock" size={48} color={colors.primary} />
          </View>
          <Text style={styles.title}>App Locked</Text>
          <Text style={styles.subtitle}>
            Enter your passphrase to unlock
          </Text>
        </View>

        {isLockedOut ? (
          <View style={styles.lockoutContainer}>
            <Text style={styles.lockoutText}>Too many failed attempts</Text>
            <Text style={styles.lockoutTimer}>{formatTime(lockoutSeconds)}</Text>
            <Text style={styles.lockoutHint}>Please wait before trying again</Text>
          </View>
        ) : (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="Enter passphrase"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleUnlock}
            />

            <Button
              title={isVerifying ? 'Verifying...' : 'Unlock'}
              onPress={handleUnlock}
              disabled={isVerifying || !passphrase.trim()}
              style={styles.unlockButton}
            />

            {security.failedAttempts > 0 && (
              <Text style={styles.attemptsText}>
                {security.remainingAttempts} attempt
                {security.remainingAttempts === 1 ? '' : 's'} remaining
              </Text>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Icon name="shield" size={20} color={colors.textMuted} />
          <Text style={styles.footerText}>
            Your data is protected and stored locally
          </Text>
        </View>
      </KeyboardAvoidingView>

      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    padding: 24,
  },
  header: {
    alignItems: 'center' as const,
    marginBottom: SPACING.xxl,
  },
  lockIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.lg,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    ...TYPOGRAPHY.h2,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  inputContainer: {
    marginBottom: SPACING.xxl,
  },
  input: {
    ...TYPOGRAPHY.body,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.lg,
    color: colors.text,
    marginBottom: SPACING.lg,
    textAlign: 'center' as const,
  },
  unlockButton: {
    marginTop: SPACING.sm,
  },
  attemptsText: {
    ...TYPOGRAPHY.body,
    textAlign: 'center' as const,
    color: colors.warning,
    marginTop: SPACING.md,
  },
  lockoutContainer: {
    alignItems: 'center' as const,
    marginBottom: SPACING.xxl,
  },
  lockoutText: {
    ...TYPOGRAPHY.h2,
    color: colors.error,
    marginBottom: SPACING.md,
  },
  lockoutTimer: {
    ...TYPOGRAPHY.display,
    fontSize: 48,
    fontWeight: '200' as const,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  lockoutHint: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  footer: {
    alignItems: 'center' as const,
    opacity: 0.7,
    gap: SPACING.sm,
  },
  footerText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
});
