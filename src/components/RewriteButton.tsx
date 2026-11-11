import React, { useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert, Modal, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { ensureTextModel } from '../atlasTools/models';
import { completeSmallTask } from '../services/engines';
const BACKGROUNDCOLOR_RGBA_0_0_0_0_4 = 'rgba(0,0,0,0.4)';
const literalStyles = StyleSheet.create({
  s1: { paddingHorizontal: 8, justifyContent: 'center' },
  s2: { flex: 1, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_4, justifyContent: 'flex-end' },
  s3: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12, paddingBottom: 28, width: '100%', maxWidth: 720, alignSelf: 'center' },
  s4: { fontSize: 13, padding: 8 },
  s5: { padding: 14, borderTopWidth: 1 },
  s6: { fontSize: 16 },
});


const ACTIONS: { label: string; instruction: string }[] = [
  { label: 'Fix grammar & spelling', instruction: 'Fix grammar, spelling and punctuation. Keep the wording and meaning otherwise the same.' },
  { label: 'Shorter', instruction: 'Make it shorter and clearer. Keep the meaning.' },
  { label: 'Longer / more detail', instruction: 'Expand it with a bit more detail, in the same voice.' },
  { label: 'More formal', instruction: 'Rewrite it in a polite, professional tone.' },
  { label: 'Friendlier', instruction: 'Rewrite it in a warm, friendly, casual tone.' },
  { label: 'More confident', instruction: 'Rewrite it to sound more confident and direct, without being rude.' },
  { label: 'Simpler words', instruction: 'Rewrite it with simple everyday words.' },
];

/** Composer button: rewrite what you typed with the local model, before sending. */
export function RewriteButton({ text, onResult, colors }: { text: string; onResult: (t: string) => void; colors: any }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (instruction: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await ensureTextModel(null);
      const out: string = await completeSmallTask([
        { id: 's', role: 'system', content: `You rewrite the user's text. ${instruction} Reply with ONLY the rewritten text - no quotes, no explanations.`, timestamp: 0 },
        { id: 'u', role: 'user', content: text, timestamp: 0 },
      ], 'The model is busy. Try again in a moment.');
      const cleaned = out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^["“](.*)["”]$/s, '$1');
      if (cleaned) onResult(cleaned);
    } catch (e: any) {
      Alert.alert('Could not rewrite', String(e?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} disabled={busy} style={literalStyles.s1} accessibilityLabel="Rewrite">
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="edit-3" size={18} color={colors.primary} />}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)} style={literalStyles.s2}>
          <View style={[{ backgroundColor: colors.surface }, literalStyles.s3]}>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s4]}>Rewrite your message (on this phone, before sending)</Text>
            {ACTIONS.map((a) => (
              <TouchableOpacity key={a.label} onPress={() => run(a.instruction)} style={[literalStyles.s5, { borderTopColor: colors.border }]}>
                <Text style={[{ color: colors.text }, literalStyles.s6]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
