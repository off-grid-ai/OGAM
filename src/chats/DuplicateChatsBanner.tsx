import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { useChatStore } from '../stores';
import { duplicateGroups } from './mergeDuplicates';
import { MergeChatsSheet } from './MergeChatsSheet';

/** Shown above the chat list when chats share a title (often after syncing): "Review and merge" opens a sheet showing each chat's agent, project and size before anything is merged. */
export const DuplicateChatsBanner: React.FC = () => {
  const { colors } = useTheme();
  const conversations = useChatStore((s) => s.conversations);
  const groups = useMemo(() => duplicateGroups(conversations), [conversations]);
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;
  const extra = groups.reduce((n, g) => n + g.length - 1, 0);
  return (
    <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="duplicate-chats">
      <Text style={[styles.text, { color: colors.textSecondary }]}>{extra} {extra === 1 ? 'chat shares' : 'chats share'} a title with another chat.</Text>
      <TouchableOpacity onPress={() => setOpen(true)} testID="duplicate-merge" accessibilityLabel="Review and merge chats with the same title"><Text style={{ color: colors.primary }}>Review and merge</Text></TouchableOpacity>
      <MergeChatsSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  text: { flex: 1, fontSize: 13 },
});
