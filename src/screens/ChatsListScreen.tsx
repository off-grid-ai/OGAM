import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { ModelSelectorModal } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { ScreenHeader } from '../components/ScreenHeader';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { onnxImageGeneratorService, activeModelService, llmService, remoteServerManager } from '../services';
import { loadModelWithOverride } from '../services/loadModelWithOverride';
import { Conversation } from '../types';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { byRecentActivity } from '../utils/conversationOrdering';
import { formatWhen } from '../utils/localTime';
import { useConversationPreviewLine } from '../hooks/useConversationPreviewLine';
type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ChatsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// This screen keeps its list actions together so search, selection, and swipe deletion share one owner.
// eslint-disable-next-line max-lines-per-function
export const ChatsListScreen: React.FC = () => {
  const previewLine = useConversationPreviewLine();
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const conversations = useChatStore(s => s.conversations);
  const { deleteConversation, setActiveConversation } = useChatStore.getState();
  const { getProject } = useProjectStore();
  const activeImageModelId = useAppStore(s => s.activeImageModelId);
  const { removeImagesByConversationId } = useAppStore.getState();
  const { modelId: activeTextModelId } = useActiveTextModel();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hasModels = !!activeTextModelId || !!activeImageModelId;

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = () => {
    if (hasModels) {
      navigation.navigate('Chat', {});
      return;
    }
    setShowModelSelector(true);
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
        onSuccess: () => { setShowModelSelector(false); navigation.navigate('Chat', {}); },
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
        onSuccess: () => { setShowModelSelector(false); navigation.navigate('Chat', {}); },
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

  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(showAlert(
      'Delete Chat',
      `Delete "${conversation.title}"? This will also delete all images generated in this chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            const imageIds = removeImagesByConversationId(conversation.id);
            for (const imageId of imageIds) {
              onnxImageGeneratorService.deleteGeneratedImage(imageId).catch(() => {});
            }
            deleteConversation(conversation.id);
          },
        },
      ]
    ));
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    const selected = conversations.filter(conversation => selectedIds.has(conversation.id));
    if (selected.length === 0) return;
    setAlertState(showAlert(
      'Delete Chats',
      `Delete ${selected.length} chats? This will also delete all images generated in these chats.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            for (const conversation of selected) {
              const imageIds = removeImagesByConversationId(conversation.id);
              for (const imageId of imageIds) {
                onnxImageGeneratorService.deleteGeneratedImage(imageId).catch(() => {});
              }
              deleteConversation(conversation.id);
            }
            stopSelecting();
          },
        },
      ],
    ));
  };

  const formatDate = (dateString: string): string => formatWhen(dateString);

  const renderRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const renderChat = ({ item, index }: { item: Conversation; index: number }) => {
    const project = item.projectId ? getProject(item.projectId) : null;
    const selected = selectedIds.has(item.id);
    // The preview line comes from the shared rule, so this list and the Mac's read the same.
    const preview = previewLine(item.messages);

    return (
      <Swipeable
        enabled={!selecting}
        renderRightActions={selecting ? undefined : () => renderRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <AnimatedListItem
          index={index}
          trigger={focusTrigger}
          style={styles.chatItem}
          onPress={() => {
            if (!selecting) {
              handleChatPress(item);
              return;
            }
            setSelectedIds(current => {
              const next = new Set(current);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
          }}
          testID={`conversation-item-${index}`}
        >
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            {preview ? (
              <Text style={styles.chatPreview} numberOfLines={1}>
                {preview}
              </Text>
            ) : null}
            {project && (
              <View style={styles.projectBadge}>
                <Text style={styles.projectBadgeText}>{project.name}</Text>
              </View>
            )}
          </View>
          <Icon
            name={selecting ? (selected ? 'check-square' : 'square') : 'chevron-right'}
            size={20}
            color={selected ? colors.primary : colors.textMuted}
          />
        </AnimatedListItem>
      </Swipeable>
    );
  };

  const sortedConversations = useMemo(() => byRecentActivity(conversations), [conversations]);
  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedConversations;
    return sortedConversations.filter(conversation =>
      conversation.title.toLowerCase().includes(query) ||
      conversation.messages.some(message => message.content.toLowerCase().includes(query)),
    );
  }, [searchQuery, sortedConversations]);
  const allVisibleSelected =
    visibleConversations.length > 0 &&
    visibleConversations.every(conversation => selectedIds.has(conversation.id));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Chats"
        variant="tab"
        right={
          selecting ? (
            <Button title="Cancel" variant="secondary" size="small" onPress={stopSelecting} />
          ) : (
            <View style={styles.headerActions}>
              {conversations.length > 0 ? (
                <Button
                  title="Select"
                  variant="secondary"
                  size="small"
                  onPress={() => setSelecting(true)}
                />
              ) : null}
              <Button
                title="New"
                variant="primary"
                size="small"
                onPress={handleNewChat}
                icon={<Icon name="plus" size={16} color={colors.primary} />}
              />
            </View>
          )
        }
      />

      {sortedConversations.length === 0 ? (
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
              {hasModels
                ? 'Start a new conversation to begin chatting with your local AI.'
                : 'Download a model from the Models tab to start chatting.'}
            </Text>
          </AnimatedEntry>
          {hasModels && (
            <AnimatedListItem index={3} staggerMs={60} trigger={focusTrigger} hapticType="impactLight" style={styles.emptyButton} onPress={handleNewChat}>
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={styles.emptyButtonText}>New Chat</Text>
            </AnimatedListItem>
          )}
        </View>
      ) : (
        <>
          <View style={styles.searchRow}>
            <Icon name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search chats"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              testID="chat-search-input"
            />
            {searchQuery ? (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear chat search"
                hitSlop={SPACING.sm}
              >
                <Icon name="x" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          {selecting ? (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
              <Button
                title={allVisibleSelected ? 'Clear' : 'Select all'}
                variant="ghost"
                size="small"
                onPress={() => {
                  setSelectedIds(current => {
                    const next = new Set(current);
                    for (const conversation of visibleConversations) {
                      if (allVisibleSelected) next.delete(conversation.id);
                      else next.add(conversation.id);
                    }
                    return next;
                  });
                }}
              />
              <Button
                title="Delete"
                variant="danger"
                size="small"
                disabled={selectedIds.size === 0}
                onPress={handleBulkDelete}
              />
            </View>
          ) : null}
          <FlatList
            data={visibleConversations}
            renderItem={renderChat}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={Platform.OS !== 'android'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.noMatches}>No chats match your search.</Text>
            }
            testID="conversation-list"
          />
        </>
      )}
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
          navigation.navigate('Chat', {});
        }}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  swipeableContainer: {
    overflow: 'visible' as const,
  },
  list: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.lg,
  },
  headerActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  searchInput: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flex: 1,
    paddingVertical: SPACING.sm,
  },
  selectionBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  selectionCount: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    flex: 1,
  },
  noMatches: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    paddingVertical: SPACING.xxl,
  },
  chatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: 10,
    marginBottom: SPACING.md,
    ...shadows.small,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  chatTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    flex: 1,
    marginRight: SPACING.sm,
  },
  chatDate: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
  },
  chatPreview: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: 1,
  },
  projectBadge: {
    alignSelf: 'flex-start' as const,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs / 2,
    borderRadius: 4,
    marginTop: SPACING.sm - 2,
  },
  projectBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.xl - SPACING.xs,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  emptyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.xl - SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    gap: SPACING.sm,
  },
  emptyButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 44,
    borderRadius: 10,
    marginBottom: SPACING.md,
    marginLeft: SPACING.sm,
  },
});
