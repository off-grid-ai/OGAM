import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, AppState, PermissionsAndroid, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { hasAllFiles, requestAllFiles, workspaceDir } from '../atlasTools/deviceTools';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1 },
  s2: { flex: 1, paddingRight: 8 },
  s3: { fontSize: 14, fontWeight: '600' },
  s4: { fontSize: 12 },
  s5: { borderWidth: 1 },
  s6: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  s7: { borderRadius: 10, padding: 14, marginBottom: 14 },
  s8: { fontSize: 15, fontWeight: '600' },
  s9: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 6 },
  s10: { fontSize: 12, marginTop: 8 },
});


/** Settings: what the assistant may reach on this phone. */
export function AssistantAccessCard() {
  const { colors } = useTheme();
  const [files, setFiles] = useState(false);
  const [cal, setCal] = useState(false);
  const [ws, setWs] = useState('');
  const refresh = useCallback(async () => {
    setFiles(await hasAllFiles());
    setCal(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALENDAR));
    setWs(await workspaceDir().catch(() => ''));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  const row = (label: string, on: boolean, action: () => void, desc: string) => (
    <View style={[literalStyles.s1, { borderTopColor: colors.border }]}>
      <View style={literalStyles.s2}>
        <Text style={[{ color: colors.text }, literalStyles.s3]}>{label}</Text>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s4]}>{desc}</Text>
      </View>
      {on ? <Text style={{ color: colors.primary }}>On ✓</Text> : (
        <TouchableOpacity onPress={action} style={[literalStyles.s5, { borderColor: colors.primary }, literalStyles.s6]}>
          <Text style={{ color: colors.primary }}>Allow</Text>
        </TouchableOpacity>
      )}
    </View>
  );
  return (
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s7]}>
      <Text style={[{ color: colors.text }, literalStyles.s8]}>Assistant access</Text>
      <Text style={[{ color: colors.textSecondary }, literalStyles.s9]}>
        What agents with file/calendar tools (like Phone Assistant) can reach. Everything stays on the phone; changes always ask you first.
      </Text>
      {row('All files access', files, () => requestAllFiles(), 'Read and edit your documents anywhere on the phone. Without it, agents only use their own folder.')}
      {row('Calendar', cal, async () => { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALENDAR); refresh(); }, 'Read your events. Adding an event opens the calendar for you to save.')}
      <Text style={[{ color: colors.textMuted }, literalStyles.s10]}>Workspace folder: {ws}</Text>
    </View>
  );
}
