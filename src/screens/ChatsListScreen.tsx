import React, { useMemo, useRef, useState } from 'react';
import {
  chatListPreviewLine,
  workflowFailureMessage,
  type ConversationRecord,
} from '@offgrid/application';
import { View, Text, FlatList, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  CompositeNavigationProp,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { portableMessageText } from '../utils/portableMessageText';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { ModelSelectorModal } from '../components';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../components/CustomAlert';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { ScreenHeader } from '../components/ScreenHeader';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useChatStore } from '../stores';
import { useActiveMobileModel } from '../hooks/useActiveMobileModel';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { applicationFacade } from '../services/applicationFacade';
import {
  selectModelRoute,
  unloadAndClearModel,
} from '../services/modelServices/modelFacadeCommands';
import { DownloadedModel } from '../types';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { formatWhen } from '../utils/localTime';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ChatsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const ChatsListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { conversations, projects, messages } = useWorkspaceContentProjection();
  const { setActiveConversation } = useChatStore.getState();
  const { modelId: activeTextModelId } = useActiveTextModel();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const deleteInFlight = useRef(false);

  const hasImageModel = !!useActiveMobileModel('image').model;
  const hasModels = !!activeTextModelId || hasImageModel;

  const projectsById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects],
  );
  const lastMessageByConversation = useMemo(() => {
    const latest = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      const current = latest.get(message.conversationId);
      if (!current || message.position > current.position) {
        latest.set(message.conversationId, message);
      }
    }
    return latest;
  }, [messages]);

  const handleChatPress = (conversation: ConversationRecord) => {
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

  const handleSelectTextModel = async (model: DownloadedModel) => {
    try {
      await selectModelRoute({
        source: 'local',
        hostId: model.engine,
        modality: 'text',
        modelId: model.id,
      });
      setShowModelSelector(false);
      navigation.navigate('Chat', {});
    } catch (error) {
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    }
  };

  const handleUnloadTextModel = async () => {
    setIsModelLoading(true);
    try {
      await unloadAndClearModel('text');
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleUnloadImageModel = async () => {
    setIsModelLoading(true);
    try {
      await unloadAndClearModel('image');
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleDeleteChat = (conversation: ConversationRecord) => {
    setAlertState(
      showAlert(
        'Delete Chat',
        `Delete "${conversation.title}"? This will also delete all images generated in this chat.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (deleteInFlight.current) return;
              deleteInFlight.current = true;
              setAlertState(hideAlert());
              try {
                const outcome =
                  await applicationFacade().workflows.deleteConversation(
                    conversation.id,
                  );
                if (!outcome.ok) {
                  setAlertState(
                    showAlert(
                      'Chat Not Deleted',
                      workflowFailureMessage(outcome.failure),
                    ),
                  );
                  return;
                }
              } catch (error) {
                setAlertState(
                  showAlert(
                    'Chat Not Deleted',
                    error instanceof Error ? error.message : String(error),
                  ),
                );
              } finally {
                deleteInFlight.current = false;
              }
            },
          },
        ],
      ),
    );
  };

  const formatDate = (dateString: string): string => formatWhen(dateString);

  const renderRightActions = (conversation: ConversationRecord) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const renderChat = ({
    item,
    index,
  }: {
    item: ConversationRecord;
    index: number;
  }) => {
    const project = item.projectId ? projectsById.get(item.projectId) : null;
    const lastMessage = lastMessageByConversation.get(item.id);
    const preview = chatListPreviewLine(
      lastMessage?.portable.role,
      portableMessageText(lastMessage?.portable.content),
    );

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <AnimatedListItem
          index={index}
          trigger={focusTrigger}
          style={styles.chatItem}
          onPress={() => handleChatPress(item)}
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
          <Icon name="chevron-right" size={20} color={colors.textMuted} />
        </AnimatedListItem>
      </Swipeable>
    );
  };

  // Shared owns the canonical recent-activity order, including the stable ID tie-breaker.
  const sortedConversations = conversations;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Chats"
        variant="tab"
        right={
          <Button
            title="New"
            variant="primary"
            size="small"
            onPress={handleNewChat}
            icon={<Icon name="plus" size={16} color={colors.primary} />}
          />
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
            <AnimatedListItem
              index={3}
              staggerMs={60}
              trigger={focusTrigger}
              hapticType="impactLight"
              style={styles.emptyButton}
              onPress={handleNewChat}
            >
              <Icon name="plus" size={18} color={colors.primary} />
              <Text style={styles.emptyButtonText}>New Chat</Text>
            </AnimatedListItem>
          )}
        </View>
      ) : (
        <FlatList
          data={sortedConversations}
          renderItem={renderChat}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== 'android'}
          testID="conversation-list"
        />
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
        onBrowseModels={tab => {
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
