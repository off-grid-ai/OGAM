import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { lockedChatsNotOpen, exportBackup, importBackup } from '../atlasTools/backup';
import { lastBackupText, useBackupReminder } from '../atlasTools/backupReminder';
import { NearbySyncSettings } from '../components/settings/NearbySyncSettings';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const BackupScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const lastBackupAt = useBackupReminder((s) => s.lastBackupAt);
  const [backupPasswordAction, setBackupPasswordAction] = useState<'export' | 'import' | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  const runEncryptedBackup = async () => {
    if (backupPassword.length < 12) { Alert.alert('Password too short', 'Use at least 12 characters. A forgotten password cannot be recovered.'); return; }
    setBackupBusy(true);
    try {
      const result = backupPasswordAction === 'export'
        ? await exportBackup(backupPassword) : await importBackup(backupPassword);
      const skipped = backupPasswordAction === 'export' ? lockedChatsNotOpen() : 0;
      if (result) Alert.alert(
        backupPasswordAction === 'export' ? 'Encrypted backup saved' : 'Encrypted backup restored',
        String(result) + (skipped ? `\n\n${skipped} PIN-locked chat${skipped === 1 ? ' was' : 's were'} saved as locked ciphertext that only opens on this phone. To move ${skipped === 1 ? 'it' : 'them'} to a new phone, open ${skipped === 1 ? 'it' : 'them'} with ${skipped === 1 ? 'its' : 'their'} PIN, then back up again.` : ''),
      );
      setBackupPassword('');
      setBackupPasswordAction(null);
    } catch (e: any) { Alert.alert('Encrypted backup failed', String(e?.message ?? e)); }
    finally { setBackupBusy(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Backup &amp; sync</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.navSection}>
          <TouchableOpacity style={styles.navItem} onPress={() => {
            Alert.alert('Unencrypted backup', 'This is a readable JSON file of projects and settings only. Project documents and chats are not included; use Encrypted backup to preserve project documents and ordinary chats. Never store plain backups in a shared location.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Export anyway', onPress: async () => {
                try {
                  const name = await exportBackup();
                  if (name) Alert.alert('Backup saved', `Saved as ${name}. Keep a copy somewhere else too (PC, cloud, SD card). Plain JSON backups do not include project documents, private chats or models. Use Encrypted backup for project files.`);
                } catch (e: any) {
                  if (!/cancel/i.test(String(e?.message || e))) Alert.alert('Backup failed', String(e?.message || e));
                }
              } },
            ]);
          }}>
            <View style={styles.navItemIcon}><Icon name="save" size={16} color={colors.textSecondary} /></View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Back up</Text>
              <Text style={styles.navItemDesc}>{lastBackupText(lastBackupAt)}. Agents, lessons, projects and settings (encrypted chats excluded)</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={() => { setBackupPassword(''); setBackupPasswordAction('export'); }}>
            <View style={styles.navItemIcon}><Icon name="lock" size={16} color={colors.textSecondary} /></View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Encrypted backup (chats + project files)</Text>
              <Text style={styles.navItemDesc}>Keeps PIN-locked chats locked; excludes protected projects and model files</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={() => { setBackupPassword(''); setBackupPasswordAction('import'); }}>
            <View style={styles.navItemIcon}><Icon name="unlock" size={16} color={colors.textSecondary} /></View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Restore encrypted backup</Text>
              <Text style={styles.navItemDesc}>Enter password and choose an .atlasbackup file</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.navItem, styles.navItemLast]} onPress={() => {
            Alert.alert('Restore backup?', 'This replaces your current agents, projects, chats and settings with the ones in the backup file.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Choose file', onPress: async () => {
                try {
                  const n = await importBackup();
                  if (n) Alert.alert('Restored', `${n} items restored. Close the app completely and open it again to finish.`);
                } catch (e: any) {
                  if (!/cancel/i.test(String(e?.message || e))) Alert.alert('Restore failed', String(e?.message || e));
                }
              } },
            ]);
          }}>
            <View style={styles.navItemIcon}><Icon name="upload" size={16} color={colors.textSecondary} /></View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Restore</Text>
              <Text style={styles.navItemDesc}>Load a backup file (from this or another device)</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <NearbySyncSettings />
      </ScrollView>

      <Modal visible={backupPasswordAction !== null} transparent animationType="fade" onRequestClose={() => { if (!backupBusy) { setBackupPasswordAction(null); setBackupPassword(''); } }}>
        <View style={styles.backupBackdrop}>
          <View style={styles.backupSheet}>
            <Text style={styles.backupTitle}>{backupPasswordAction === 'export' ? 'Protect your backup' : 'Unlock encrypted backup'}</Text>
            <Text style={{ color: colors.textSecondary }}>Use a password of at least 12 characters and keep it safe. Encrypted backups include chats (PIN-locked chats stay locked), project knowledge-base files and searchable text (up to 25 MB of project files), agents and settings. Protected projects are included only if they are unlocked when you back up: they stay sealed with their own PIN and open on a new phone with that PIN. Locked protected projects and downloaded models are not included. Restoring never deletes a protected project or locked chat that is only on this phone.</Text>
            <TextInput placeholder="Backup password" placeholderTextColor={colors.textMuted} secureTextEntry value={backupPassword} onChangeText={setBackupPassword} autoCapitalize="none" autoCorrect={false} style={styles.backupInput} />
            <View style={styles.backupActions}>
              <TouchableOpacity disabled={backupBusy} onPress={() => { setBackupPassword(''); setBackupPasswordAction(null); }}>
                <Text style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={backupBusy} onPress={runEncryptedBackup}>
                <Text style={styles.backupContinueLabel}>{backupBusy ? 'Working…' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  backButton: { width: 36, padding: SPACING.xs },
  headerTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  navSection: { backgroundColor: colors.surface, borderRadius: 8, marginBottom: SPACING.lg, overflow: 'hidden' as const },
  navItem: { flexDirection: 'row' as const, alignItems: 'center' as const, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  navItemLast: { borderBottomWidth: 0 },
  navItemIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: SPACING.md },
  navItemContent: { flex: 1 },
  navItemTitle: { ...TYPOGRAPHY.body, color: colors.text },
  navItemDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 2 },
  backupBackdrop: { flex: 1, justifyContent: 'center' as const, padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  backupSheet: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, gap: 14 },
  backupTitle: { color: colors.text, fontSize: 18, fontWeight: '600' as const },
  backupInput: { color: colors.text, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  backupActions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 18 },
  backupContinueLabel: { color: colors.primary, fontWeight: '600' as const },
});
