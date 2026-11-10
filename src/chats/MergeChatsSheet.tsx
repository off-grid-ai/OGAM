import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppSheet } from '../components/AppSheet';
import { useTheme } from '../theme';
import { useChatStore, useProjectStore } from '../stores';
import { useAgentStore } from '../stores/agentStore';
import { duplicateGroups, mergedMessageCount, summarizeChat, type MergeChoice } from './mergeDuplicates';
import { mergeWithUndo } from './undoMerge';

/**
 * Review chats that share a title, then merge them one set at a time (or all at once). For each set it shows every chat:
 * agent, project, how many messages, when it was last used and its last line, and lets the person choose which chat's
 * settings the merged chat keeps and which agent it uses. Nothing is merged until a Merge button is pressed.
 */
export const MergeChatsSheet: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const conversations = useChatStore((s) => s.conversations);
  const agents = useAgentStore((s) => s.agents);
  const projects = useProjectStore((s) => s.projects);
  const groups = useMemo(() => duplicateGroups(conversations), [conversations]);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const names = {
    agent: (id?: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? 'Unknown agent' : 'No agent'),
    project: (id?: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? 'Unknown project' : 'No project'),
  };
  const set = (key: string, patch: MergeChoice) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const mergeSets = (only?: string[]) => {
    mergeWithUndo({ only, choices });
    if (only && groups.length <= 1) onClose();
    if (!only) onClose();
  };
  const chip = (on: boolean) => [styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surface : 'transparent' }];

  return (
    <AppSheet visible={visible} onClose={onClose} title="MERGE CHATS" enableDynamicSizing>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
        {!groups.length && <Text style={{ color: colors.textMuted }}>No chats share a title now.</Text>}
        {groups.map((g) => {
          const key = g[0].id;
          const choice = choices[key] ?? {};
          const longest = [...g].sort((a, b) => b.messages.length - a.messages.length)[0];
          const baseId = choice.baseId ?? longest.id;
          const base = g.find((c) => c.id === baseId) ?? longest;
          const agentId = choice.agentId === undefined ? (base.agentId ?? null) : choice.agentId;
          const total = mergedMessageCount(g, choice);
          return (
            <View key={key} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID={`merge-set-${key}`}>
              <Text style={[styles.title, { color: colors.text }]}>{g[0].title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {g.length} chats become one with {total} messages, in time order. Repeated messages are kept once.
              </Text>

              <Text style={[styles.label, { color: colors.textSecondary }]}>Keep the settings of (agent, project, instructions)</Text>
              {g.map((c) => {
                const sum = summarizeChat(c, names);
                const on = c.id === baseId;
                return (
                  <TouchableOpacity key={c.id} onPress={() => set(key, { baseId: c.id, agentId: undefined })} testID={`merge-base-${c.id}`}
                    accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.row, { borderColor: on ? colors.primary : colors.border }]}>
                    <Text style={[styles.rowTitle, { color: colors.text }]}>{on ? '● ' : '○ '}{sum.messages} messages · {sum.agent} · {sum.project}</Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>Last used {new Date(sum.updated).toLocaleString()}</Text>
                    {!!sum.preview && <Text numberOfLines={2} style={[styles.meta, { color: colors.textSecondary }]}>"{sum.preview}"</Text>}
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Agent for the merged chat</Text>
              <View style={styles.chips}>
                {[{ id: null as string | null, name: 'No agent' }, ...agents.map((a) => ({ id: a.id as string | null, name: a.name }))].map((a) => (
                  <TouchableOpacity key={a.id ?? 'none'} onPress={() => set(key, { agentId: a.id })} testID={`merge-agent-${a.id ?? 'none'}`}
                    accessibilityRole="radio" accessibilityState={{ selected: agentId === a.id }} style={chip(agentId === a.id)}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>{a.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity onPress={() => mergeSets(g.map((c) => c.id))} style={[styles.button, { backgroundColor: colors.primary }]} testID={`merge-this-${key}`} accessibilityRole="button">
                <Text style={{ color: colors.background, fontWeight: '600' }}>Merge these {g.length} chats</Text>
              </TouchableOpacity>
            </View>
          );
        })}
        {groups.length > 1 && (
          <TouchableOpacity onPress={() => mergeSets()} style={[styles.button, { borderColor: colors.primary, borderWidth: 1 }]} testID="merge-all" accessibilityRole="button">
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Merge all {groups.length} sets with the choices above</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </AppSheet>
  );
};

const styles = StyleSheet.create({
  scroll: { maxHeight: 560 },
  pad: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 12, marginTop: 8, textTransform: 'uppercase' },
  row: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  rowTitle: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
});
