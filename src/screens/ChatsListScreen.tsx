import React, { useMemo, useState } from 'react';
import { View, Text, SectionList } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
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
import { ListGroupSeparator, listGroupRowEnds, listRowStyle } from '../components/ListGroup';
import { groupByRecency } from '@offgrid/ui';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { ScreenHeader } from '../components/ScreenHeader';
import { ListSearchBar } from '../components/ListSearchBar';
import { PairedComputerSearchFooter } from '../components/PairedComputerSearchFooter';
import { pairedComputer } from '../services/pairedComputerSearch';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useChatStore, useProjectStore, useAppStore, useRemoteServerStore } from '../stores';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { activeModelService, llmService, remoteServerManager } from '../services';
import { deleteChatImages, imagesNotDeletedAlert } from '../services/chatImageCleanup';
import { Conversation } from '../types';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { byRecentActivity } from '../utils/conversationOrdering';
import { formatWhen } from '../utils/localTime';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';
import { useIsFocused } from '@react-navigation/native';
import { LivingField } from '../components/LivingField';
type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ChatsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const SEARCH_BAR = { placeholder: 'Search chats', clearLabel: 'Clear chat search', testID: 'chat-search-input' };

export const ChatsListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isFocused = useIsFocused();
  const conversations = useChatStore(s => s.conversations);
  const { deleteConversation, setActiveConversation } = useChatStore.getState();
  const { getProject } = useProjectStore();
  const activeImageModelId = useAppStore(s => s.activeImageModelId);
  const { modelId: activeTextModelId } = useActiveTextModel();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeVideoModelId = useAppStore(s => s.activeVideoModelId);
  const remoteVideoServerId = useRemoteServerStore(s => s.activeRemoteMediaServerIds.video);
  const hasModels = !!activeTextModelId || !!activeImageModelId || !!activeVideoModelId || !!remoteVideoServerId;

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

  const handleSelectTextModel = (model: any) => {
    activeModelService.selectTextModel(model.id);
    setShowModelSelector(false);
    navigation.navigate('Chat', {});
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

  const reportImagesNotDeleted = (count: number) => {
    if (count > 0) setAlertState(imagesNotDeletedAlert(count));
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
          onPress: async () => {
            setAlertState(hideAlert());
            const notDeleted = await deleteChatImages(conversation.id);
            deleteConversation(conversation.id);
            reportImagesNotDeleted(notDeleted);
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
          onPress: async () => {
            setAlertState(hideAlert());
            let notDeleted = 0;
            for (const conversation of selected) {
              notDeleted += await deleteChatImages(conversation.id);
              deleteConversation(conversation.id);
            }
            stopSelecting();
            reportImagesNotDeleted(notDeleted);
          },
        },
      ],
    ));
  };

  const renderRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${conversation.title}`}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  // One line per chat: a quiet icon for an image or video chat, its title, its project when it has
  // one, and when it was last active, so chats with the same title can still be told apart. Each
  // date group is one surface divided by hairlines (brand: lists in one surface).
  const renderChat = ({ item, index: rowIndex, section }: { item: Conversation; index: number; section: { data: readonly Conversation[] } }) => {
    const project = item.projectId ? getProject(item.projectId) : null;
    const selected = selectedIds.has(item.id);
    const index = listIndex.get(item.id) ?? 0;
    const kind = item.messages[item.messages.length - 1]?.turnKind ?? 'text';

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
          style={[styles.chatItem, listGroupRowEnds(rowIndex, section.data.length)]}
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
          {selecting ? (
            <Icon
              name={selected ? 'check-square' : 'square'}
              size={18}
              color={selected ? colors.primary : colors.textMuted}
            />
          ) : null}
          {kind !== 'text' ? (
            <Icon name={kind === 'video' ? 'video' : 'image'} size={14} color={colors.textMuted} />
          ) : null}
          <Text style={styles.chatTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {project ? (
            <Text style={styles.projectName} numberOfLines={1}>
              {project.name}
            </Text>
          ) : null}
          <Text style={styles.chatTime}>{formatWhen(item.updatedAt)}</Text>
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
  const sections = useMemo(
    () =>
      groupByRecency(visibleConversations, conversation => Date.parse(conversation.updatedAt)).map(group => ({
        title: group.label,
        data: group.items,
      })),
    [visibleConversations],
  );
  const listIndex = useMemo(
    () => new Map(visibleConversations.map((conversation, index) => [conversation.id, index])),
    [visibleConversations],
  );
  const computerResults = selecting ? null : (
    <PairedComputerSearchFooter
      query={searchQuery}
      conversations={conversations}
      listed={visibleConversations}
      onOpenChat={conversationId => {
        setActiveConversation(conversationId);
        navigation.navigate('Chat', { conversationId });
      }}
    />
  );
  // With no chats yet, a paired computer is still worth searching: the bar stays.
  const hasComputer = useRemoteServerStore(s => !!pairedComputer(s.servers, s.activeServerId));
  const searchBar = <ListSearchBar value={searchQuery} onChangeText={setSearchQuery} {...SEARCH_BAR} />;
  const allVisibleSelected =
    visibleConversations.length > 0 &&
    visibleConversations.every(conversation => selectedIds.has(conversation.id));


  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* The living field behind the tab, resting while the tab is hidden. */}
      <LivingField active={isFocused} />
      <ScreenHeader
        title="Chats"
        variant="tab"
        right={
          selecting ? (
            <Button
              title=""
              accessibilityLabel="Cancel selection"
              variant="ghost"
              size="small"
              onPress={stopSelecting}
              icon={<Icon name="x" size={16} color={colors.text} />}
            />
          ) : (
            <View style={styles.headerActions}>
              {conversations.length > 0 ? (
                <Button
                  title=""
                  accessibilityLabel="Select chats"
                  variant="ghost"
                  size="small"
                  onPress={() => setSelecting(true)}
                  icon={<Icon name="check-square" size={16} color={colors.text} />}
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

      {sortedConversations.length === 0 && hasComputer ? searchBar : null}
      {sortedConversations.length === 0 && hasComputer && searchQuery.trim() ? computerResults : null}
      {sortedConversations.length === 0 ? (hasComputer && searchQuery.trim() ? null : (
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
      )) : (
        <>
          {searchBar}
          {selecting ? (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
              <Button
                title={allVisibleSelected ? 'Clear' : 'Select all'}
                variant="ghost"
                size="small"
                onPress={() => {
                  setSelectedIds(
                    allVisibleSelected
                      ? new Set()
                      : new Set(visibleConversations.map(conversation => conversation.id)),
                  );
                }}
              />
              <Button
                title=""
                accessibilityLabel="Delete selected chats"
                variant="ghost"
                size="small"
                disabled={selectedIds.size === 0}
                onPress={handleBulkDelete}
                icon={<Icon name="trash-2" size={16} color={colors.error} />}
              />
            </View>
          ) : null}
          <SectionList
            {...SCROLL_DEPTH_PROPS}
            sections={sections}
            renderItem={renderChat}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionLabel} accessibilityRole="header">
                {section.title}
              </Text>
            )}
            stickySectionHeadersEnabled={false}
            ItemSeparatorComponent={ListGroupSeparator}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            {...LIST_CLIPPING_PROPS}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <Text style={styles.noMatches}>No chats match your search.</Text>
            }
            ListFooterComponent={computerResults}
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
        onUnloadModel={handleUnloadTextModel}
        onUnloadImageModel={handleUnloadImageModel}
        isLoading={isModelLoading}
        onAddServer={() => {
          setShowModelSelector(false);
          navigation.navigate('RemoteServers');
        }}
        onBrowseModels={(tab) => {
          setShowModelSelector(false);
          navigation.navigate('ModelsTab', { initialTab: tab === 'search' ? 'embedding' : tab });
        }}
        onSelectionComplete={() => {
          setShowModelSelector(false);
          navigation.navigate('Chat', {});
        }}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  swipeableContainer: {
    overflow: 'visible' as const,
  },
  // brand Mobile profile: standard screen padding is 24px.
  list: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  headerActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
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
  // One line per chat, flat on the page (no box, no hairlines), about 48 px tall.
  chatItem: {
    ...listRowStyle,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surfaceGlass,
  },
  chatTime: {
    ...TYPOGRAPHY.meta,
    fontSize: 11,
    color: colors.textMuted,
  },
  chatTitle: {
    ...TYPOGRAPHY.body,
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  projectName: {
    ...TYPOGRAPHY.meta,
    fontSize: 11,
    color: colors.textMuted,
    maxWidth: 120,
  },
  // Desktop's group label: Today, Yesterday, This week, Older.
  sectionLabel: {
    ...TYPOGRAPHY.label,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xs,
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
