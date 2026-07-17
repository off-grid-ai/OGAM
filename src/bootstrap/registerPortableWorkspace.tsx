import React, { useMemo } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  PortableWorkspaceScreen,
  PortableWorkspaceSettingsSection,
  PortableWorkspaceUiController,
} from '@offgrid/sync-react-native';
import type { PortableWorkspaceTheme } from '@offgrid/sync-react-native';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { useTheme } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { mobileWorkspacePort } from '../services/portableWorkspace/mobileWorkspacePort';

const controller = new PortableWorkspaceUiController(mobileWorkspacePort);

const usePortableTheme = (): PortableWorkspaceTheme => {
  const { colors, shadows } = useTheme();
  return useMemo(() => ({
    colors: {
      primary: colors.primary,
      background: colors.background,
      surface: colors.surface,
      surfaceLight: colors.surfaceLight,
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      textDisabled: colors.textDisabled,
      border: colors.border,
      borderFocus: colors.borderFocus,
      error: colors.error,
    },
    spacing: SPACING,
    typography: TYPOGRAPHY,
    smallShadow: shadows.small,
    cardRadius: SPACING.sm,
  }), [colors, shadows]);
};

const WorkspaceTransferScreen: React.FC = () => {
  const navigation = useNavigation();
  const theme = usePortableTheme();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <PortableWorkspaceScreen controller={controller} theme={theme} onBack={() => navigation.goBack()} />
    </SafeAreaView>
  );
};

const WorkspaceTransferSettingsSection: React.FC = () => {
  const navigation = useNavigation<any>();
  const theme = usePortableTheme();
  return (
    <PortableWorkspaceSettingsSection
      controller={controller}
      theme={theme}
      onOpen={() => navigation.navigate('WorkspaceTransfer')}
      testID="workspace-transfer-settings"
    />
  );
};

registerScreen({ name: 'WorkspaceTransfer', component: WorkspaceTransferScreen });
registerSettingsSection(WorkspaceTransferSettingsSection);

const styles = StyleSheet.create({ screen: { flex: 1 } });
