import React, { useState } from 'react';
import { AppSwitch } from '../components/AppSwitch';
import {
  View,
  Text,
  ScrollView,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { ScreenHeader } from '../components/ScreenHeader';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAuthStore } from '../stores';
import { authService } from '../services';
import { PassphraseSetupScreen } from './PassphraseSetupScreen';
import { AliveScreen } from '../components/AliveScreen';

export const SecuritySettingsScreen: React.FC = () => {
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
              authService.removePassphrase().then(() => {
                setAuthEnabled(false);
              }).catch(() => {});
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
    <AliveScreen style={styles.container}>
      <ScreenHeader title="Security" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>App lock</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Passphrase lock</Text>
              <Text style={styles.settingHint}>Ask for your passphrase when the app opens.</Text>
            </View>
            <AppSwitch
              value={authEnabled}
              onValueChange={handleTogglePassphrase}
            />
          </View>

          {authEnabled && (
            <Button
              title="Change passphrase"
              variant="primary"
              size="medium"
              onPress={handleChangePassphrase}
              icon={<Icon name="edit-2" size={16} color={colors.primary} />}
              style={{ alignSelf: 'flex-start' as const, marginTop: SPACING.lg }}
            />
          )}
        </Card>

        <Card style={styles.infoCard}>
          <Icon name="info" size={18} color={colors.textMuted} />
          <Text style={styles.infoText}>
            The app locks when you leave it. Your passphrase stays on this phone.
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
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  // brand Mobile profile: 24px screen padding; the cards are the shared Card surface.
  content: {
    paddingHorizontal: SPACING.xl,
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
  },
  infoText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
