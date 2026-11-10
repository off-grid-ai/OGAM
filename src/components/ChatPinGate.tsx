import React, { useEffect, useState } from 'react';
import { StyleSheet, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useChatStore } from '../stores/chatStore';
import { onProtectedChatsRelocked, unlockChat } from '../stores/encryptedChatStorage';
import { useTheme } from '../theme';
import { useNavigation } from '@react-navigation/native';
import { formatWait, pinWaitRemaining, recordPinFailure, recordPinSuccess } from '../services/pinThrottle';
const OPACITY_0_5 = 0.5;
const OPACITY_1 = 1;
const literalStyles = StyleSheet.create({
  s1: { flex: 1, justifyContent: 'center', padding: 32, gap: 18 },
  s2: { fontSize: 24, fontWeight: '700' },
  s3: { padding: 12, borderRadius: 9, borderWidth: 1 },
  s4: { padding: 10 },
  s5: { textAlign: 'center' },
  s6: { padding: 14, borderRadius: 10 },
  s7: { textAlign: 'center', fontWeight: '700' },
  s8: { padding: 12, borderRadius: 10, borderWidth: 1 },
});


const unlocked = new Map<string, string>();
onProtectedChatsRelocked(() => unlocked.clear());

export function ChatPinGate({ conversationId }: { conversationId?: string | null }) {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const verifier = useChatStore(s => s.conversations.find(c => c.id === conversationId)?.pinVerifier);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    return onProtectedChatsRelocked(() => { setRevision(v => v + 1); setPin(''); });
  }, []);
  useEffect(() => { setPin(''); setError(''); }, [conversationId]);
  const locked = !!conversationId && !!verifier && unlocked.get(conversationId) !== verifier;
  void revision;
  const submit = async (unlockMatching = false) => {
    if (!conversationId || !verifier || busy) return;
    const wait = await pinWaitRemaining('chat');
    if (wait > 0) { setError(`Too many wrong PINs. Try again in ${formatWait(wait)}.`); return; }
    setBusy(true);
    try {
      // Native decryption checks the PIN and authenticates this specific item.
      await unlockChat(conversationId, pin);
      unlocked.set(conversationId, verifier);
      if (unlockMatching) {
        // The same PIN can protect any number of separately encrypted chats;
        // items with different PINs remain locked.
        for (const chat of useChatStore.getState().conversations) {
          if (!chat.pinVerifier || chat.id === conversationId || unlocked.get(chat.id) === chat.pinVerifier) continue;
          try { await unlockChat(chat.id, pin); unlocked.set(chat.id, chat.pinVerifier); } catch { /* different credential */ }
        }
      }
      await recordPinSuccess('chat');
      setPin(''); setError(''); setRevision(v => v + 1);
    } catch {
      const next = await recordPinFailure('chat');
      setError(next > 0 ? `Incorrect PIN. Wait ${formatWait(next)} before trying again.` : 'Incorrect PIN or protected chat could not be opened.');
      setPin('');
    } finally { setBusy(false); }
  };
  return <Modal visible={locked} animationType="fade" onRequestClose={() => navigation.goBack()} transparent={false}>
    <View style={[literalStyles.s1, { backgroundColor: colors.background }]}>
      <Text style={[{ color: colors.text }, literalStyles.s2]}>Locked conversation</Text>
      <Text style={{ color: colors.textSecondary }}>Enter this chat's PIN to open it.</Text>
      <TextInput value={pin} onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 12))} secureTextEntry keyboardType="number-pad" placeholder="4–12 digit PIN" placeholderTextColor={colors.textMuted} style={[{ color: colors.text }, literalStyles.s3, { borderColor: colors.border }]} />
      {!!error && <Text style={{ color: colors.error }}>{error}</Text>}
      <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s4}><Text style={[{ color: colors.text }, literalStyles.s5]}>Back to chats</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy || pin.length < 4} onPress={() => submit(false)} style={[{ backgroundColor: colors.primary }, literalStyles.s6, { opacity: busy ? OPACITY_0_5 : OPACITY_1 }]}>
        <Text style={[{ color: colors.background }, literalStyles.s7]}>Unlock this chat</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={busy || pin.length < 4} onPress={() => submit(true)} style={[literalStyles.s8, { borderColor: colors.border }]}>
        <Text style={[{ color: colors.text }, literalStyles.s5]}>Unlock other chats using the same PIN</Text>
      </TouchableOpacity>
    </View>
  </Modal>;
}
