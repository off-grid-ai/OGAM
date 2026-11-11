/* eslint-disable react-native/no-inline-styles, react-native/no-color-literals, max-lines -- Existing protected-chat vault, search, and folder list share access-control state. */
import React, { useState, useEffect } from 'react';
import { useWideLayout } from '../hooks/useWideLayout';
import { View, Text, FlatList, TouchableOpacity, Platform, Modal, TextInput } from 'react-native';
import { unlockChat, onProtectedChatsRelocked } from '../stores/encryptedChatStorage';
import { useChatOptions } from '../components/ChatOptions';
import { useChatPrefs, useVaultSession, visibleConversations } from '../atlasTools/chatPrefs';
import { formatWait, pinWaitRemaining, recordPinFailure, recordPinSuccess } from '../services/pinThrottle';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { IMAGE_NEW_CHAT_STEP_INDEX, IMAGE_DRAW_STEP_INDEX } from '../components/onboarding/spotlightConfig';
import { setPendingSpotlight } from '../components/onboarding/spotlightState';
import { Button } from '../components/Button';
import { ModelSelectorModal } from '../components';
import { CustomAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './ChatsListScreen.styles';
import { SPACING } from '../constants';

import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { useAgentStore } from '../stores/agentStore';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { activeModelService, llmService, remoteServerManager } from '../services';
import { loadModelWithOverride } from '../services/loadModelWithOverride';
import { Conversation } from '../types';
import { buildChatListRows, type ChatListRow } from './chatListGrouping';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { DuplicateChatsBanner } from '../chats/DuplicateChatsBanner';
type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ChatsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const ChatsListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const wide = useWideLayout();
  const styles = useThemedStyles(createStyles);
  const conversations = useChatStore(s => s.conversations);
  const { setActiveConversation } = useChatStore.getState();
  const [showArchived, setShowArchived] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const chatOptions = useChatOptions();
  const hideLocked = useChatPrefs(s => s.hideLockedChats);
  const vaultOpen = useVaultSession(s => s.open);
  const setVaultOpen = useVaultSession(s => s.setOpen);
  const [vaultPrompt, setVaultPrompt] = useState(false);
  const [vaultPin, setVaultPin] = useState('');
  const [vaultError, setVaultError] = useState('');
  useEffect(() => onProtectedChatsRelocked(() => setVaultOpen(false)), [setVaultOpen]);
  /** Opens the hidden vault: unlocks every locked chat that uses this PIN. */
  const openVault = async () => {
    const wait = await pinWaitRemaining('chat');
    if (wait > 0) { setVaultError(`Too many wrong PINs. Try again in ${formatWait(wait)}.`); return; }
    let opened = 0;
    for (const chat of useChatStore.getState().conversations.filter(c => c.pinVerifier)) {
      try { await unlockChat(chat.id, vaultPin); opened++; } catch { /* other PIN */ }
    }
    setVaultPin('');
    if (!opened) {
      // Same answer for "no chats" and "wrong PIN", so the vault cannot be probed.
      const next = await recordPinFailure('chat');
      setVaultError(next > 0 ? `Nothing opened. Wait ${formatWait(next)}.` : 'Nothing opened with that PIN.');
      return;
    }
    await recordPinSuccess('chat');
    setVaultError(''); setVaultPrompt(false); setVaultOpen(true);
  };
  const { projects, getProject } = useProjectStore();
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  // Folders the user closed while searching (search opens matching folders by itself).
  const [searchCollapsedIds, setSearchCollapsedIds] = useState<string[]>([]);
  const activeImageModelId = useAppStore(s => s.activeImageModelId);
  const onboardingChecklist = useAppStore(s => s.onboardingChecklist);
  const shownSpotlights = useAppStore(s => s.shownSpotlights);
  const { markSpotlightShown } = useAppStore.getState();
  const { modelId: activeTextModelId } = useActiveTextModel();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [pendingPrivateChat, setPendingPrivateChat] = useState(false);
  const { goTo } = useSpotlightTour();

  // Reactive: image model loaded → spotlight "New Chat" button (step 14)
  useEffect(() => {
    if (
      activeImageModelId &&
      !shownSpotlights.imageNewChat &&
      !onboardingChecklist.triedImageGen
    ) {
      markSpotlightShown('imageNewChat');
      // Queue step 15 so ChatScreen picks it up when "New Chat" is tapped
      setPendingSpotlight(IMAGE_DRAW_STEP_INDEX);
      setTimeout(() => goTo(IMAGE_NEW_CHAT_STEP_INDEX), 800);
    }
  }, [activeImageModelId, shownSpotlights, onboardingChecklist.triedImageGen, markSpotlightShown, goTo]);

  const hasModels = !!activeTextModelId || !!activeImageModelId;

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = (privateChat = false) => {
    setPendingPrivateChat(privateChat);
    useAgentStore.getState().setActiveAgent(null);
    if (hasModels) navigation.navigate('Chat', privateChat ? { privateChat: true } : {});
    else setShowModelSelector(true);
  };

  const handleSelectTextModel = async (model: any) => {
    // Shared inline Load-Anyway flow: a memory-blocked load offers "Load Anyway"
    // here just like the chat screen (was a dead-end "Failed to load model").
    await loadModelWithOverride(
      (opts) => activeModelService.loadTextModel(model.id, undefined, opts),
      {
        setAlertState,
        onAttemptStart: () => setIsModelLoading(true),
        onAttemptEnd: () => setIsModelLoading(false),
        onSuccess: () => { setShowModelSelector(false); navigation.navigate('Chat', pendingPrivateChat ? { privateChat: true } : {}); },
      },
    );
  };

  const handleSelectImageModel = async (model: any) => {
    await loadModelWithOverride(
      (opts) => activeModelService.loadImageModel(model.id, undefined, opts),
      {
        setAlertState,
        onAttemptStart: () => setIsModelLoading(true),
        onAttemptEnd: () => setIsModelLoading(false),
        onSuccess: () => { setShowModelSelector(false); navigation.navigate('Chat', pendingPrivateChat ? { privateChat: true } : {}); },
      },
    );
  };

  const handleUnloadTextModel = async () => {
    setIsModelLoading(true);
    try {
      remoteServerManager.clearActiveRemoteModel();
      if (llmService.isModelLoaded()) {
        await activeModelService.unloadTextModel();
      }
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleUnloadImageModel = async () => {
    setIsModelLoading(true);
    try {
      await activeModelService.unloadImageModel();
    } finally {
      setIsModelLoading(false);
    }
  };


  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } 
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    
  };


  const renderChat = ({ item, index, nested = false }: { item: Conversation; index: number; nested?: boolean }) => {
    const project = item.projectId ? getProject(item.projectId) : null;
    const lastMessage = item.messages[item.messages.length - 1];

    return (
        <AnimatedListItem
          index={index}
          trigger={focusTrigger}
          style={[styles.chatItem, nested && { marginLeft: SPACING.lg }]}
          onPress={() => handleChatPress(item)}
          onLongPress={() => chatOptions.open(item)}
          testID={`conversation-item-${index}`}
        >
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {item.pinVerifier ? 'Locked conversation' : item.title}
              </Text>
              <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            {item.pinVerifier ? <Text style={styles.chatPreview}>PIN required</Text> : lastMessage && (
              <Text style={styles.chatPreview} numberOfLines={1}>
                {lastMessage.role === 'user' ? 'You: ' : ''}{lastMessage.content}
              </Text>
            )}
            {project && !nested && (
              <View style={styles.projectBadge}>
                <Text style={styles.projectBadgeText}>{project.name}</Text>
              </View>
            )}
          </View>
          {!!item.isPinned && <Icon name="star" size={15} color={colors.primary} />}
          <Icon name="chevron-right" size={20} color={colors.textMuted} />
        </AnimatedListItem>
    );
  };

  // Project chats are grouped into expandable folders; no duplicate top-level rows.
  const sortedConversations = visibleConversations(conversations, hideLocked, vaultOpen)
    .filter(c => !!c.isArchived === showArchived);
  const query = searchText.trim().toLocaleLowerCase();
  const matchingConversations = query ? sortedConversations.filter(chat => {
    const project = chat.projectId ? getProject(chat.projectId) : null;
    const projectMatch = project && !project.pinVerifier && project.name.toLowerCase().includes(query);
    if (projectMatch) return true;
    if (project?.pinVerifier || chat.pinVerifier) return false;
    return chat.title.toLocaleLowerCase().includes(query) ||
      chat.messages.some(message => (message.role === 'user' || message.role === 'assistant') &&
        message.content.toLocaleLowerCase().includes(query));
  }) : sortedConversations;
  const searchExpanded = new Set(expandedProjectIds);
  if (query) for (const chat of matchingConversations) if (chat.projectId && !searchCollapsedIds.includes(chat.projectId)) searchExpanded.add(chat.projectId);
  const chatRows = buildChatListRows(matchingConversations, projects, searchExpanded);
  const renderFolder = (row: Extract<ChatListRow, { kind: 'folder' }>) => {
    const open = searchExpanded.has(row.projectId);
    return (
      <TouchableOpacity testID={`project-chat-folder-${  row.projectId}`}
        accessibilityRole="button" accessibilityLabel={row.locked ? 'Locked project' : `${row.name  }, ${  row.count  } chats`}
        onPress={() => {
          if (row.locked) {
            navigation.navigate('ProjectDetail', { projectId: row.projectId });
            return;
          }
          setExpandedProjectIds(ids => open ? ids.filter(id => id !== row.projectId) : [...ids, row.projectId]);
          if (query) setSearchCollapsedIds(ids => open ? [...ids, row.projectId] : ids.filter(id => id !== row.projectId));
        }}
        style={[styles.chatItem, { gap: SPACING.sm, borderWidth: 1, borderColor: colors.border }]}>
        <Icon name={row.locked ? 'lock' : 'folder'} size={21} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.chatTitle} numberOfLines={1}>{row.name}</Text>
          {!row.locked && <Text style={styles.chatPreview}>{row.count} {row.count === 1 ? 'chat' : 'chats'}</Text>}
        </View>
        {row.pinned && <Icon name="star" size={15} color={colors.primary} />}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          // Long-press the title to open hidden PIN-locked chats (the "vault").
          onLongPress={() => { if (vaultOpen) { setVaultOpen(false); return; } setVaultError(''); setVaultPin(''); setVaultPrompt(true); }}
          delayLongPress={600}
          activeOpacity={1}
          accessibilityHint="Long press to open or close locked chats">
          <Text style={styles.title}>{showArchived ? 'Archived chats' : vaultOpen && hideLocked ? 'Chats + vault' : 'Chats'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setSearchOpen(v => !v); setSearchText(''); setSearchCollapsedIds([]); }}
          accessibilityLabel={searchOpen ? 'Close chat search' : 'Search chats'} style={{ padding: 8 }}>
          <Icon name={searchOpen ? 'x' : 'search'} size={19} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleNewChat(true)} testID="new-private-chat"
          accessibilityLabel="New private chat (not saved)" style={{ padding: 8 }}>
          <Icon name="eye-off" size={19} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowArchived(v => !v)} accessibilityLabel={showArchived ? 'Show current chats' : 'Show archived chats'} style={{ padding: 8 }}>
          <Icon name={showArchived ? 'inbox' : 'archive'} size={19} color={colors.textMuted} />
        </TouchableOpacity>
        <AttachStep index={[2, 14]}>
          <Button
            title="New"
            variant="primary"
            size="small"
            onPress={() => handleNewChat()}
            icon={<Icon name="plus" size={16} color={colors.primary} />}
          />
        </AttachStep>
      </View>

      {searchOpen && (
        <View style={{ marginHorizontal: SPACING.lg, marginTop: 10, marginBottom: 8,
          borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.surface }}>
          <TextInput autoFocus value={searchText} onChangeText={setSearchText}
            testID="search-chats-input" placeholder="Search chats and projects"
            placeholderTextColor={colors.textMuted} style={{ color: colors.text, paddingHorizontal: 13, paddingVertical: 10 }} />
        </View>
      )}
      {chatRows.length === 0 ? (
        <View style={styles.emptyState}>
          <AnimatedEntry index={0} staggerMs={60} trigger={focusTrigger}>
            <View style={styles.emptyIcon}>
              <Icon name="message-circle" size={32} color={colors.textMuted} />
            </View>
          </AnimatedEntry>
          <AnimatedEntry index={1} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyTitle}>No Chats Yet</Text>
          </AnimatedEntry>
          <AnimatedEntry index={2} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyText}>
              {query ? 'No matching chats or projects.' : hasModels
                ? 'Start a new conversation to begin chatting with your local AI.'
                : 'Download a model from the Models tab to start chatting.'}
            </Text>
          </AnimatedEntry>
          {hasModels && (
            <AnimatedListItem index={3} staggerMs={60} trigger={focusTrigger} hapticType="impactLight" style={styles.emptyButton} onPress={() => handleNewChat()}>
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={styles.emptyButtonText}>New Chat</Text>
            </AnimatedListItem>
          )}
        </View>
      ) : (
        <FlatList
          data={chatRows}
          renderItem={({ item, index }) => item.kind === 'folder'
            ? renderFolder(item)
            : renderChat({ item: item.conversation, index, nested: item.nested })}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, wide.column]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== 'android'}
          testID="conversation-list"
          ListHeaderComponent={<DuplicateChatsBanner />}
        />
      )}
      <Modal visible={vaultPrompt} transparent animationType="fade" onRequestClose={() => setVaultPrompt(false)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14, gap: 14 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Enter PIN</Text>
            <TextInput value={vaultPin} onChangeText={v => setVaultPin(v.replace(/\D/g, '').slice(0, 12))} placeholder="4–12 digits" placeholderTextColor={colors.textMuted} secureTextEntry keyboardType="number-pad" autoFocus style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 8 }} />
            {!!vaultError && <Text style={{ color: colors.error }}>{vaultError}</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }}>
              <TouchableOpacity onPress={() => setVaultPrompt(false)}><Text style={{ color: colors.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity disabled={vaultPin.length < 4} onPress={openVault}><Text style={{ color: colors.primary, fontWeight: '700' }}>Open</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {chatOptions.element}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
      <ModelSelectorModal
        visible={showModelSelector}
        onClose={() => setShowModelSelector(false)}
        onSelectModel={handleSelectTextModel}
        onSelectImageModel={handleSelectImageModel}
        onUnloadModel={handleUnloadTextModel}
        onUnloadImageModel={handleUnloadImageModel}
        isLoading={isModelLoading}
        onAddServer={() => {
          setShowModelSelector(false);
          navigation.navigate('RemoteServers');
        }}
        onBrowseModels={(tab) => {
          setShowModelSelector(false);
          navigation.navigate('ModelsTab', { initialTab: tab });
        }}
        onSelectionComplete={() => {
          setShowModelSelector(false);
          navigation.navigate('Chat', { privateChat: pendingPrivateChat });
        }}
      />
    </SafeAreaView>
  );
};
