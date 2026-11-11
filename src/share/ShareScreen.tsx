import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore, useChatStore } from '../stores';
import { useActiveTextModel } from '../hooks/useActiveTextModel';

/** What Atlas can do with text another app shared (or that was selected and sent with "Ask Atlas"). Each choice opens a chat with the request typed. */
export const SHARE_ACTIONS: { id: string; label: string; icon: string; prompt: (text: string) => string }[] = [
  { id: 'ask', label: 'Ask about it', icon: 'message-circle', prompt: (t) => `${t}\n\n` },
  { id: 'summarize', label: 'Summarize', icon: 'align-left', prompt: (t) => `Summarize this:\n\n${t}` },
  { id: 'explain', label: 'Explain simply', icon: 'help-circle', prompt: (t) => `Explain this in simple words:\n\n${t}` },
  { id: 'translate', label: 'Translate to English', icon: 'globe', prompt: (t) => `Translate this to English:\n\n${t}` },
  { id: 'reply', label: 'Draft a reply', icon: 'corner-up-left', prompt: (t) => `Draft a short, polite reply to this:\n\n${t}` },
];

/** Long text is cut so it fits a small model's memory; the box shows what was kept. */
const MAX_CHARS = 6000;

export const ShareScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const text = String((useRoute<any>().params as { text?: string } | undefined)?.text ?? '');
  const { modelId: textModelId } = useActiveTextModel();
  const activeModelId = useAppStore((s) => s.activeModelId);
  const downloaded = useAppStore((s) => s.downloadedModels);
  const kept = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}...` : text;

  const start = (prompt: (t: string) => string) => {
    const modelId = textModelId || activeModelId || downloaded[0]?.id;
    if (!modelId) { Alert.alert('No model yet', 'Download a text model first (Models tab), then share again.'); return; }
    const conversationId = useChatStore.getState().createConversation(modelId);
    navigation.replace('Chat', { conversationId, starter: prompt(kept) });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Close"><Icon name="x" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>What should Atlas do with this?</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.preview, { color: colors.textSecondary, borderColor: colors.border, backgroundColor: colors.surface }]} numberOfLines={12} testID="share-preview">{kept}</Text>
        {SHARE_ACTIONS.map((a) => (
          <TouchableOpacity key={a.id} style={[styles.action, { borderColor: colors.border }]} onPress={() => start(a.prompt)} testID={`share-${a.id}`} accessibilityRole="button">
            <Icon name={a.icon} size={18} color={colors.primary} />
            <Text style={[styles.label, { color: colors.text }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 20, fontWeight: '400', flexShrink: 1 },
  body: { padding: 16, gap: 10 },
  preview: { fontSize: 13, borderWidth: 1, borderRadius: 10, padding: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 12 },
  label: { fontSize: 16 },
});
