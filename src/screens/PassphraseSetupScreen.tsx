import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button, Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { mobileSecurity } from '../services';

/** The words the person already knows for each refusal. Shared decides; this only names it. */
const FAILURE_TITLES: Readonly<Record<string, string>> = {
  too_short: 'Invalid Passphrase',
  too_long: 'Invalid Passphrase',
  mismatch: 'Mismatch',
  wrong_passphrase: 'Incorrect Passphrase',
  locked_out: 'Too Many Attempts',
};

export type PassphraseScreenMode = 'enable' | 'change' | 'disable';

interface PassphraseSetupScreenProps {
  mode?: PassphraseScreenMode;
  onComplete: () => void;
  onCancel: () => void;
}

export const PassphraseSetupScreen: React.FC<PassphraseSetupScreenProps> = ({
  mode = 'enable',
  onComplete,
  onCancel,
}) => {
  const isChanging = mode === 'change';
  const isDisabling = mode === 'disable';
  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // Shared decides whether the passphrase is acceptable and commits the stored passphrase and
    // the lock together. This screen only carries what the person typed and shows the answer.
    try {
      const outcome = isDisabling
        ? await mobileSecurity.disable({ passphrase: currentPassphrase })
        : isChanging
        ? await mobileSecurity.change({
            currentPassphrase,
            passphrase: newPassphrase,
            confirmation: confirmPassphrase,
          })
        : await mobileSecurity.enable({
            passphrase: newPassphrase,
            confirmation: confirmPassphrase,
          });
      if (!outcome.ok) {
        setAlertState(showAlert(FAILURE_TITLES[outcome.reason] ?? 'Error', outcome.message));
        return;
      }
      setAlertState(showAlert(
        'Success',
        isDisabling
          ? 'Passphrase lock turned off'
          : isChanging
            ? 'Passphrase changed successfully'
            : 'Passphrase lock enabled',
      ));
      onComplete();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelButton}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {isDisabling
              ? 'Turn Off Lock'
              : isChanging
                ? 'Change Passphrase'
                : 'Set Up Passphrase'}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <View style={styles.iconContainer}>
            <View style={styles.iconBox}>
              <Icon name="lock" size={48} color={colors.primary} />
            </View>
          </View>

          <Text style={styles.description}>
            {isDisabling
              ? 'Enter your passphrase to turn the lock off. Your saved passphrase is removed with it.'
              : isChanging
                ? 'Enter your current passphrase and then set a new one.'
                : 'Create a passphrase to lock the app. You will need to enter it each time you open the app.'}
          </Text>

          <Card style={styles.inputCard}>
            {(isChanging || isDisabling) && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Current Passphrase</Text>
                <TextInput
                  style={styles.input}
                  value={currentPassphrase}
                  onChangeText={setCurrentPassphrase}
                  placeholder="Enter current passphrase"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            {!isDisabling && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {isChanging ? 'New Passphrase' : 'Passphrase'}
              </Text>
              <TextInput
                style={styles.input}
                value={newPassphrase}
                onChangeText={setNewPassphrase}
                placeholder="Enter passphrase (min 6 characters)"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            )}

            {!isDisabling && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm Passphrase</Text>
              <TextInput
                style={styles.input}
                value={confirmPassphrase}
                onChangeText={setConfirmPassphrase}
                placeholder="Re-enter passphrase"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            )}
          </Card>

          {!isDisabling && (
          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>Tips for a good passphrase:</Text>
            <Text style={styles.tipItem}>• Use a mix of words and numbers</Text>
            <Text style={styles.tipItem}>• Make it memorable but not obvious</Text>
            <Text style={styles.tipItem}>• Avoid personal information</Text>
          </View>
          )}

          <Button
            title={(() => {
              if (isSubmitting) return 'Saving...';
              if (isDisabling) return 'Turn Off Lock';
              return isChanging ? 'Change Passphrase' : 'Enable Lock';
            })()}
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={styles.submitButton}
          />
        </ScrollView>
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
  headerSpacer: {
    width: 50,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelButton: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: SPACING.lg,
  },
  iconContainer: {
    alignItems: 'center' as const,
    marginVertical: SPACING.xl,
  },
  iconBox: {
    width: 96,
    height: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  description: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  inputCard: {
    marginBottom: SPACING.xl,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  inputLabel: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  input: {
    ...TYPOGRAPHY.body,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    color: colors.text,
  },
  tips: {
    marginBottom: SPACING.xl,
  },
  tipsTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.sm,
  },
  tipItem: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    lineHeight: 20,
  },
  submitButton: {
    marginBottom: 32,
  },
});
