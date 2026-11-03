import React, { useState } from 'react';
import { Clipboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { MarkdownText } from '../components/MarkdownText';
import { useChatStore } from '../stores';
import { usePins } from './store';

/** Everything you pinned from any chat: read, copy, open the chat it came from, or unpin. */
export const PinsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { pins, remove } = usePins();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const shown = pins.filter((p) => !query.trim() || `${p.text} ${p.conversationTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  const open = (conversationId: string | null) => {
    if (conversationId && useChatStore.getState().conversations.some((c) => c.id === conversationId)) navigation.navigate('Chat', { conversationId });
  };
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Pinned</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {pins.length > 3 && (
          <TextInput value={query} onChangeText={setQuery} placeholder="Search pinned" placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="pins-search" />
        )}
        {shown.map((p) => (
          <View key={p.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID={`pin-${p.id}`}>
            <Text style={[styles.meta, { color: colors.textMuted }]}>{p.conversationTitle} · {new Date(p.pinnedAt).toLocaleDateString()}</Text>
            <MarkdownText>{p.text}</MarkdownText>
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => { Clipboard.setString(p.text); setCopied(p.id); }} testID={`pin-copy-${p.id}`}>
                <Text style={{ color: colors.primary }}>{copied === p.id ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => open(p.conversationId)} testID={`pin-open-${p.id}`}><Text style={{ color: colors.primary }}>Open the chat</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => remove(p.id)} testID={`pin-remove-${p.id}`}><Text style={{ color: colors.error }}>Unpin</Text></TouchableOpacity>
            </View>
          </View>
        ))}
        {!pins.length && <Text style={[styles.meta, { color: colors.textMuted }]} testID="pins-empty">Nothing pinned yet. Open a message's menu in any chat and tap Pin.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 22, fontWeight: '400' },
  body: { padding: 16, gap: 12, paddingBottom: 60 },
  meta: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
});
