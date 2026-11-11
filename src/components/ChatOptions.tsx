/* eslint-disable react-native/no-inline-styles, max-params -- Legacy dialog styles and compact action helper use dynamic theme tokens. */
/**
 * One long-press menu for a chat, shared by every chat list (Home recents, Chats tab,
 * project chats, an open chat): rename, pin, share, set/remove PIN, archive, delete. Lists call `open(chat)` and
 * render `element` once; the dialogs live here so every list offers the same options.
 */
import React, { useRef, useState } from 'react';
import { Alert, Modal, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from './CustomAlert';
import { useTheme } from '../theme';
import { useChatStore } from '../stores';
import { protectChat, permanentlyUnprotectChat } from '../stores/encryptedChatStorage';
import { deleteChatWithUndo } from '../chats/undoDelete';
import type { Conversation } from '../types';
import { conversationToPlainText, conversationToText, hasShareableTurns } from '../utils/chatExport';
import { safeFileName, saveMarkdown, saveText } from '../study/exportFiles';


/** `onDeleted` runs after a chat is deleted (an open chat uses it to leave the screen). */
export function useChatOptions(opts?: { onDeleted?: (conversationId: string) => void }): { open: (c: Conversation) => void; confirmDelete: (c: Conversation) => void; element: React.ReactElement } {
  const { colors } = useTheme();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [menuTarget, setMenuTarget] = useState<Conversation | null>(null);
  const afterMenuClose = useRef<(() => void) | null>(null);
  const finishMenu = (next?: () => void) => {
    afterMenuClose.current = next ?? null;
    setMenuTarget(null);
  };
  const [renameTitle, setRenameTitle] = useState('');
  const [pinTarget, setPinTarget] = useState<Conversation | null>(null);
  const [pinAction, setPinAction] = useState<'set' | 'remove'>('set');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  const closePin = () => { setPinTarget(null); setNewPin(''); setNewPin2(''); };
  const savePin = async () => {
    if (!pinTarget || pinBusy) return;
    if (!/^[0-9]{4,12}$/.test(newPin)) { Alert.alert('PIN', 'Enter 4-12 digits.'); return; }
    if (pinAction === 'set' && newPin !== newPin2) { Alert.alert('PIN', 'The two PINs do not match.'); return; }
    setPinBusy(true);
    try {
      // Remove: decrypt, verify a readable plaintext write, then revoke this chat's key.
      if (pinAction === 'remove') await permanentlyUnprotectChat(pinTarget.id, newPin);
      else await protectChat(pinTarget.id, newPin);
      closePin();
    } catch (e: any) { Alert.alert('PIN update failed', String(e?.message ?? e)); }
    finally { setPinBusy(false); }
  };

  const deleteAlert = (conversation: Conversation) => (showAlert(
      'Delete Chat',
      `Delete "${conversation.pinVerifier ? 'Locked conversation' : conversation.title}"? This will also delete all images generated in this chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteChatWithUndo(conversation.id); opts?.onDeleted?.(conversation.id); } },
      ],
    ));
  // An ordinary chat is deleted at once and can be undone for a few seconds; a locked or private chat asks first.
  const confirmDelete = (conversation: Conversation) => {
    if (conversation.pinVerifier || conversation.isPrivate) { setAlertState(deleteAlert(conversation)); return; }
    deleteChatWithUndo(conversation.id);
    opts?.onDeleted?.(conversation.id);
  };

  const open = (conversation: Conversation) => setMenuTarget(conversation);
  const menuAction = (icon: string, label: string, action: () => void, destructive = false) => (
    <TouchableOpacity key={label} accessibilityRole="button" testID={`chat-option-${  label.toLowerCase().replace(/\s+/g, '-')}`}
      onPress={action} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 20 }}>
      <Icon name={icon} size={20} color={destructive ? colors.error : colors.textSecondary} />
      <Text style={{ fontSize: 16, color: destructive ? colors.error : colors.text }}>{label}</Text>
    </TouchableOpacity>
  );

  const box = { backgroundColor: colors.surface, padding: 20, borderRadius: 14, gap: 14 } as const;
  const backdrop = { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' } as const;
  const input = { color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 8 } as const;

  const element = (
    <>
      <AppSheet visible={!!menuTarget} title="Chat options" enableDynamicSizing
        onClose={() => setMenuTarget(null)}
        onClosed={() => { const action = afterMenuClose.current; afterMenuClose.current = null; action?.(); }}>
        {menuTarget && (
          <View style={{ paddingBottom: 12 }}>
            <Text numberOfLines={1} style={{ color: colors.textMuted, paddingHorizontal: 20, paddingBottom: 7 }}>
              {menuTarget.pinVerifier ? 'Locked conversation' : menuTarget.title}
            </Text>
            {menuAction('edit-2', 'Rename', () => finishMenu(() => {
              setRenameTitle(menuTarget.title); setRenameTarget(menuTarget);
            }))}
            {menuAction('star', menuTarget.isPinned ? 'Unpin from top' : 'Pin to top', () => {
              useChatStore.getState().setConversationPinned(menuTarget.id, !menuTarget.isPinned);
              finishMenu();
            })}
            {hasShareableTurns(menuTarget) && menuAction('download', 'Save as Markdown', () => finishMenu(() => {
              saveMarkdown(safeFileName(menuTarget.title || 'Chat', 'md'), conversationToText(menuTarget))
                .catch((e) => Alert.alert('Could not save', String(e?.message || e)));
            }))}
            {hasShareableTurns(menuTarget) && menuAction('file-text', 'Save as text file', () => finishMenu(() => {
              saveText(safeFileName(menuTarget.title || 'Chat', 'txt'), conversationToPlainText(menuTarget))
                .catch((e) => Alert.alert('Could not save', String(e?.message || e)));
            }))}
            {hasShareableTurns(menuTarget) && menuAction('share-2', 'Share to an app', () => finishMenu(() => {
              Share.share({ title: menuTarget.title, message: conversationToText(menuTarget) }).catch(() => undefined);
            }))}
            {menuAction(menuTarget.pinVerifier ? 'unlock' : 'lock',
              menuTarget.pinVerifier ? 'Remove chat PIN' : 'Set chat PIN', () => finishMenu(() => {
                setPinAction(menuTarget.pinVerifier ? 'remove' : 'set');
                setNewPin(''); setNewPin2(''); setPinTarget(menuTarget);
              }))}
            {menuAction('archive', menuTarget.isArchived ? 'Unarchive' : 'Archive', () => {
              useChatStore.getState().setConversationArchived(menuTarget.id, !menuTarget.isArchived);
              finishMenu();
            })}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 7 }} />
            {menuAction('trash-2', 'Delete', () => finishMenu(() => confirmDelete(menuTarget)), true)}
          </View>
        )}
      </AppSheet>
      <Modal visible={!!pinTarget} transparent animationType="fade" onRequestClose={closePin}>
        <View style={backdrop}>
          <View style={box}>
            <Text style={[styles.title, { color: colors.text }]}>{pinAction === 'remove' ? 'Remove chat PIN' : 'Set a chat PIN'}</Text>
            <Text style={{ color: colors.textSecondary }}>{pinAction === 'remove' ? 'Enter the current PIN to permanently remove encryption. The conversation will be saved normally afterward.' : 'Encrypt only this conversation with its own Android Keystore key. You can use the same PIN on other protected chats.'}</Text>
            <TextInput value={newPin} onChangeText={v => setNewPin(v.replace(/\D/g, '').slice(0, 12))} placeholder="4-12 digits" placeholderTextColor={colors.textMuted} secureTextEntry keyboardType="number-pad" style={input} testID="chat-pin-input" />
            {pinAction === 'set' && <TextInput value={newPin2} onChangeText={v => setNewPin2(v.replace(/\D/g, '').slice(0, 12))} placeholder="Type the PIN again" placeholderTextColor={colors.textMuted} secureTextEntry keyboardType="number-pad" style={input} testID="chat-pin-confirm" />}
            {pinAction === 'set' && <Text style={[styles.note, { color: colors.textMuted }]}>If you forget this PIN the chat cannot be recovered.</Text>}
            <View style={styles.buttons}>
              <TouchableOpacity onPress={closePin}><Text style={{ color: colors.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity disabled={pinBusy} onPress={savePin}><Text style={{ color: colors.primary }}>{pinAction === 'remove' ? 'Remove PIN' : 'Set PIN'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={backdrop}>
          <View style={box}>
            <Text style={[styles.title, { color: colors.text }]}>Rename chat</Text>
            <TextInput value={renameTitle} onChangeText={setRenameTitle} maxLength={100} autoFocus selectTextOnFocus style={input} testID="chat-rename-input" />
            <View style={styles.buttons}>
              <TouchableOpacity onPress={() => setRenameTarget(null)}><Text style={{ color: colors.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { if (renameTarget) useChatStore.getState().renameConversation(renameTarget.id, renameTitle); setRenameTarget(null); }}><Text style={{ color: colors.primary }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </>
  );

  return { open, confirmDelete, element };
}

const styles = StyleSheet.create({
  title: { fontSize: 18 },
  note: { fontSize: 12 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
});
