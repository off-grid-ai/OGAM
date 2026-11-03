import React, { useMemo } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { useChatStore } from '../stores';
import { duplicateGroups, mergeAllDuplicates } from './mergeDuplicates';

/** Shown above the chat list when chats share a title (often after syncing): one tap merges each set into one chat. */
export const DuplicateChatsBanner: React.FC = () => {
  const { colors } = useTheme();
  const conversations = useChatStore((s) => s.conversations);
  const groups = useMemo(() => duplicateGroups(conversations), [conversations]);
  if (!groups.length) return null;
  const extra = groups.reduce((n, g) => n + g.length - 1, 0);
  const merge = () => Alert.alert(
    'Merge chats with the same title?',
    `${groups.map((g) => `${g[0].title} (${g.length})`).join('\n')}\n\nEach set becomes one chat with all of its messages in time order.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Merge', onPress: () => useChatStore.setState((s) => ({ conversations: mergeAllDuplicates(s.conversations).chats })) },
    ],
  );
  return (
    <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="duplicate-chats">
      <Text style={[styles.text, { color: colors.textSecondary }]}>{extra} {extra === 1 ? 'chat shares' : 'chats share'} a title with another chat.</Text>
      <TouchableOpacity onPress={merge} testID="duplicate-merge" accessibilityLabel="Merge chats with the same title"><Text style={{ color: colors.primary }}>Merge</Text></TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  text: { flex: 1, fontSize: 13 },
});
