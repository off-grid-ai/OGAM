import React from 'react';
import { StyleSheet, Alert, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useChatStore } from '../stores/chatStore';
const literalStyles = StyleSheet.create({
  s1: { paddingHorizontal: 6 },
});


/** Chat header lock: make this conversation private (never saved; gone when the app closes). */
export function PrivateToggle({ colors }: { colors: any }) {
  const id = useChatStore((s: any) => s.activeConversationId);
  const isPrivate = useChatStore((s: any) => !!s.conversations.find((c: any) => c.id === id)?.isPrivate);
  if (!id) return null;
  const toggle = () => {
    const set = (v: boolean) =>
      useChatStore.setState((s: any) => ({ conversations: s.conversations.map((c: any) => (c.id === id ? { ...c, isPrivate: v } : c)) }));
    if (isPrivate) {
      Alert.alert('Save this chat?', 'It will be kept like a normal chat from now on.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Save it', onPress: () => set(false) },
      ]);
    } else {
      Alert.alert('Make this chat private?', 'It will not be saved and nothing from it is remembered: it disappears when the app is closed. Local models never send your chat anywhere; web search, web pages and remote servers still use the internet if you use them.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Make private', onPress: () => set(true) },
      ]);
    }
  };
  return (
    <TouchableOpacity onPress={toggle} style={literalStyles.s1} accessibilityLabel={isPrivate ? 'Private chat (not saved)' : 'Make chat private'}>
      <Icon name={isPrivate ? 'lock' : 'unlock'} size={13} color={isPrivate ? colors.primary : colors.textMuted} />
    </TouchableOpacity>
  );
}
