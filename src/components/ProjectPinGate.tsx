import React, { useState } from 'react';
import { StyleSheet, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { useNavigation } from '@react-navigation/native';
import { useProjectStore } from '../stores/projectStore';
import { isProtectedProjectUnlocked, unlockProject } from '../stores/protectedProjectStorage';
import { formatWait, pinWaitRemaining, recordPinFailure, recordPinSuccess } from '../services/pinThrottle';
const COLOR_FFF = '#fff';
const literalStyles = StyleSheet.create({
  s1: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  s2: { fontSize: 24, fontWeight: '700' },
  s3: { borderWidth: 1, borderRadius: 9, padding: 12 },
  s4: { padding: 10 },
  s5: { textAlign: 'center' },
  s6: { padding: 14, borderRadius: 9 },
  s7: { color: COLOR_FFF, textAlign: 'center', fontWeight: '700' },
});


/** Metadata-only project vault gate. Projects with documents/chats cannot yet
 * be protected; the protect action checks this before encryption. */
export function ProjectPinGate({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const project = useProjectStore(s => s.projects.find(p => p.id === projectId));
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  void revision;
  const locked = !!project?.pinVerifier && !isProtectedProjectUnlocked(projectId);
  const submit = async () => {
    if (busy || pin.length < 4) return;
    const wait = await pinWaitRemaining('project');
    if (wait > 0) { setError(`Too many wrong PINs. Try again in ${formatWait(wait)}.`); return; }
    setBusy(true);
    try {
      await unlockProject(projectId, pin);
      await recordPinSuccess('project');
      setPin(''); setError(''); setRevision(v => v + 1);
    } catch {
      const next = await recordPinFailure('project');
      setError(next > 0 ? `Incorrect PIN. Wait ${formatWait(next)} before trying again.` : 'Incorrect PIN or encrypted project could not be opened.');
      setPin('');
    } finally { setBusy(false); }
  };
  return <Modal visible={locked} transparent={false} animationType="fade" onRequestClose={() => navigation.goBack()}>
    <View style={[literalStyles.s1, { backgroundColor: colors.background }]}>
      <Text style={[{ color: colors.text }, literalStyles.s2]}>Protected project</Text>
      <Text style={{ color: colors.textSecondary }}>Enter this project's PIN. You can use the same PIN for multiple individually protected projects and chats.</Text>
      <TextInput secureTextEntry keyboardType="number-pad" value={pin} onChangeText={v => setPin(v.replace(/\D/g,'').slice(0,12))}
        placeholder="4–12 digit PIN" placeholderTextColor={colors.textMuted}
        style={[{ color: colors.text, borderColor: colors.border }, literalStyles.s3]} />
      {!!error && <Text style={{ color: colors.error }}>{error}</Text>}
      <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s4}><Text style={[{ color: colors.text }, literalStyles.s5]}>Back to projects</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy || pin.length < 4} onPress={submit} style={[literalStyles.s6, { backgroundColor: colors.primary }]}>
        <Text style={literalStyles.s7}>{busy ? 'Unlocking…' : 'Unlock project'}</Text>
      </TouchableOpacity>
    </View>
  </Modal>;
}
