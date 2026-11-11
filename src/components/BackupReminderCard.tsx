import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { backupDue, lastBackupText, useBackupReminder } from '../atlasTools/backupReminder';

/** On Home when it has been a while since the last backup: go to the backup buttons in Settings, or ask again in a week. */
export const BackupReminderCard: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => {
  const { colors } = useTheme();
  const due = useBackupReminder((s) => backupDue(s));
  const last = useBackupReminder((s) => s.lastBackupAt);
  if (!due) return null;
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="backup-reminder">
      <Icon name="save" size={18} color={colors.primary} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>Back up your chats and settings</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>{lastBackupText(last)}. A backup keeps them safe if you lose or reset this phone.</Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={onOpenSettings} testID="backup-reminder-open" accessibilityLabel="Open backup settings"><Text style={{ color: colors.primary }}>Back up</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => useBackupReminder.getState().snooze(7)} testID="backup-reminder-later" accessibilityLabel="Remind me in a week"><Text style={{ color: colors.textMuted }}>In a week</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10, alignItems: 'flex-start' },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '400' },
  meta: { fontSize: 12 },
  row: { flexDirection: 'row', gap: 20, marginTop: 6 },
});
