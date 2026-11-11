import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAuthStore } from '../stores';
import { authService } from '../services';
import { PassphraseSetupScreen } from './PassphraseSetupScreen';
import { useChatPrefs } from '../atlasTools/chatPrefs';

export const SecuritySettingsScreen: React.FC = () => {
  const hideLocked = useChatPrefs((s) => s.hideLockedChats);
  const setChatPrefs = useChatPrefs((s) => s.set);
  const navigation = useNavigation();
  const [showPassphraseSetup, setShowPassphraseSetup] = useState(false);
  const [isChangingPassphrase, setIsChangingPassphrase] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    isEnabled: authEnabled,
    setEnabled: setAuthEnabled,
  } = useAuthStore();

  const handleTogglePassphrase = async () => {
    if (authEnabled) {
      setAlertState(showAlert(
        'Disable Passphrase Lock',
        'Are you sure you want to disable passphrase protection?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: () => {
              setAlertState(hideAlert());
              authService.removePassphrase().then((removed) => {
                if (removed) setAuthEnabled(false);
                else setAlertState(showAlert('Could not disable lock', 'The secure passphrase could not be removed. The app lock remains enabled.'));
              }).catch(() => {
                setAlertState(showAlert('Could not disable lock', 'Secure storage was unavailable. The app lock remains enabled.'));
              });
            },
          },
        ]
      ));
    } else {
      setIsChangingPassphrase(false);
      setShowPassphraseSetup(true);
    }
  };

  const handleChangePassphrase = () => {
    setIsChangingPassphrase(true);
    setShowPassphraseSetup(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Security</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>App Lock</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Passphrase Lock</Text>
              <Text style={styles.settingHint}>Require passphrase to open app</Text>
            </View>
            <Switch
              value={authEnabled}
              onValueChange={handleTogglePassphrase}
              trackColor={{ false: colors.surfaceLight, true: `${colors.primary  }80` }}
              thumbColor={authEnabled ? colors.primary : colors.textMuted}
            />
          </View>

          {authEnabled && (
            <Button
              title="Change Passphrase"
              variant="primary"
              size="medium"
              onPress={handleChangePassphrase}
              icon={<Icon name="edit-2" size={16} color={colors.primary} />}
              style={{ alignSelf: 'flex-start' as const, marginTop: SPACING.lg }}
            />
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Locked Chats</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Hide locked chats</Text>
              <Text style={styles.settingHint}>PIN-locked chats disappear from Chats and Home. To see them, long-press the "Chats" title and enter the PIN. Long-press it again to hide them.</Text>
            </View>
            <Switch
              value={hideLocked}
              onValueChange={(v) => setChatPrefs({ hideLockedChats: v })}
              trackColor={{ false: colors.surfaceLight, true: `${colors.primary  }80` }}
              thumbColor={hideLocked ? colors.primary : colors.textMuted}
            />
          </View>
        </Card>

        <Card style={styles.infoCard}>
          <Icon name="info" size={18} color={colors.textMuted} />
          <Text style={styles.infoText}>
            The optional app lock is separate from individual chat protection. Ordinary chats are not encrypted by default. A chat you explicitly protect is encrypted with its own Android Keystore key and unlocked by its PIN; the same PIN may protect several chats. Removing protection after verifying the PIN saves that chat normally. Private chats are not persisted. Password-protected manual backups carry protected chats and projects only in sealed form: ones unlocked at backup time open on a new phone with their PIN; ones still locked can be restored only on this phone. Automatic sync is disabled.
          </Text>
        </Card>
      </ScrollView>

      <Modal
        visible={showPassphraseSetup}
        animationType="slide"
        onRequestClose={() => setShowPassphraseSetup(false)}
      >
        <PassphraseSetupScreen
          isChanging={isChangingPassphrase}
          onComplete={() => setShowPassphraseSetup(false)}
          onCancel={() => setShowPassphraseSetup(false)}
        />
      </Modal>
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

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  settingRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  settingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
