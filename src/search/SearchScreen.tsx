import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore, useChatStore, useProjectStore } from '../stores';
import { searchEverything, type SearchHit, type SearchKind } from './searchIndex';

const HEADINGS: Record<SearchKind, string> = { screen: 'Screens and settings', chat: 'Chats', project: 'Projects', model: 'Models' };

/** One box that finds chats (and what was said in them), projects, models, and every screen and settings page. */
export const SearchScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const conversations = useChatStore((s) => s.conversations);
  const projects = useProjectStore((s) => s.projects);
  const models = useAppStore((s) => s.downloadedModels);
  const hits = useMemo(
    () => searchEverything(query, { conversations, projects, models: models.map((m) => ({ id: m.id, name: m.name })) }),
    [query, conversations, projects, models],
  );
  const open = (h: SearchHit) => {
    if (h.kind === 'chat') useChatStore.getState().setActiveConversation(h.id);
    navigation.navigate(h.route, h.params);
  };
  const kinds = (Object.keys(HEADINGS) as SearchKind[]).filter((k) => hits.some((h) => h.kind === k));
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Search chats, settings, models, projects" placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]} testID="search-input" returnKeyType="search" autoCorrect={false} />
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {query.trim().length >= 2 && !hits.length && <Text style={[styles.empty, { color: colors.textMuted }]} testID="search-empty">Nothing found for "{query.trim()}".</Text>}
        {kinds.map((k) => (
          <View key={k}>
            <Text style={[styles.heading, { color: colors.textMuted }]}>{HEADINGS[k]}</Text>
            {hits.filter((h) => h.kind === k).map((h) => (
              <TouchableOpacity key={`${h.kind}-${h.id}`} style={styles.row} onPress={() => open(h)} testID={`search-hit-${h.kind}-${h.id}`} accessibilityRole="button">
                <Icon name={h.icon} size={18} color={colors.primary} />
                <View style={styles.rowText}>
                  <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{h.title}</Text>
                  {!!h.detail && <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={2}>{h.detail}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  heading: { fontSize: 12, marginTop: 16, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rowText: { flex: 1 },
  title: { fontSize: 16 },
  detail: { fontSize: 12, marginTop: 2 },
  empty: { marginTop: 24, textAlign: 'center' },
});
