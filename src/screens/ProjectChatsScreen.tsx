import React, { useMemo, useState } from 'react';
import {
  chatListPreviewLine,
  newProjectChatRouteId,
  workflowFailureMessage,
  type ConversationRecord,
} from '@offgrid/application';
import { View, Text, FlatList, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { portableMessageText } from '../utils/portableMessageText';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { formatWhen } from '../utils/localTime';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useChatStore, useAppStore } from '../stores';
import { RootStackParamList } from '../navigation/types';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import { applicationFacade } from '../services/applicationFacade';
import {
  describeWorkspaceContentFailure,
  useWorkspaceContentCommands,
} from '../hooks/useWorkspaceContentCommands';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectChats'>;

const formatDate = (dateString: string): string => formatWhen(dateString);

const chatKey = (conversation: ConversationRecord): string => conversation.id;

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  swipeableContainer: {
    overflow: 'visible' as const,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '500' as const,
  },
  addButton: {
    padding: SPACING.sm,
  },
  listContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  chatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    ...shadows.small,
  },
  chatIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.xs,
  },
  chatTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    fontWeight: '400' as const,
    flex: 1,
    marginRight: SPACING.sm,
  },
  chatDate: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
  },
  chatPreview: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginBottom: SPACING.lg,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 50,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    marginLeft: 10,
  },
});

export const ProjectChatsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const workspaceContent = useWorkspaceContentProjection();
  const { conversations, messages, projects, status } = workspaceContent;
  const { execute } = useWorkspaceContentCommands();
  const project = projects.find(item => item.id === projectId);
  const setActiveConversation = useChatStore(
    state => state.setActiveConversation,
  );
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const { modelId: activeTextModelId } = useActiveTextModel();

  const hasModels = downloadedModels.length > 0;

  const lastMessageByConversation = useMemo(() => {
    const latest = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      const current = latest.get(message.conversationId);
      if (
        !current ||
        message.position > current.position ||
        (message.position === current.position && message.id > current.id)
      ) {
        latest.set(message.conversationId, message);
      }
    }
    return latest;
  }, [messages]);
  const projectChats = useMemo(
    () =>
      conversations.filter(
        conversation => conversation.projectId === projectId,
      ),
    [conversations, projectId],
  );

  const handleChatPress = (conversation: ConversationRecord) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = async () => {
    if (!hasModels) {
      setAlertState(
        showAlert(
          'No Model',
          'Please download a model first from the Models tab.',
        ),
      );
      return;
    }
    const modelId = newProjectChatRouteId({
      selectedRouteId: activeTextModelId,
      fallbackModelId: downloadedModels[0]?.id,
    });
    if (modelId) {
      const outcome = await execute({
        type: 'create_conversation',
        modelId,
        projectId,
      });
      if (!outcome.ok) {
        setAlertState(
          showAlert(
            'Chat Not Created',
            describeWorkspaceContentFailure(outcome.failure),
          ),
        );
        return;
      }
      const created = outcome.value.changes.find(
        change => change.kind === 'put' && change.entity === 'conversation',
      );
      if (
        !created ||
        created.kind !== 'put' ||
        created.entity !== 'conversation'
      ) {
        setAlertState(
          showAlert('Chat Not Created', 'The new chat ID was not returned.'),
        );
        return;
      }
      setActiveConversation(created.record.id);
      navigation.navigate('Chat', {
        conversationId: created.record.id,
        projectId,
      });
    }
  };

  const handleDeleteChat = (conversation: ConversationRecord) => {
    setAlertState(
      showAlert('Delete Chat', `Delete "${conversation.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
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
              }
            } catch (error) {
              setAlertState(
                showAlert(
                  'Chat Not Deleted',
                  error instanceof Error ? error.message : String(error),
                ),
              );
            }
          },
        },
      ]),
    );
  };

  const renderChatRightActions = (conversation: ConversationRecord) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const renderChat = ({ item }: { item: ConversationRecord }) => {
    const lastMessage = lastMessageByConversation.get(item.id);
    const preview = chatListPreviewLine(
      lastMessage?.portable.role,
      portableMessageText(lastMessage?.portable.content),
    );

    return (
      <Swipeable
        renderRightActions={() => renderChatRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleChatPress(item)}
        >
          <View style={styles.chatIcon}>
            <Icon name="message-circle" size={14} color={colors.textMuted} />
          </View>
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
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project?.name || 'Chats'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleNewChat}
          style={styles.addButton}
          disabled={!hasModels || !project || status !== 'ready'}
        >
          <Icon
            name="plus"
            size={20}
            color={
              hasModels && project && status === 'ready'
                ? colors.primary
                : colors.textMuted
            }
          />
        </TouchableOpacity>
      </View>

      {status !== 'ready' ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>
            {status === 'stopped' ? 'Chats unavailable' : 'Loading chats…'}
          </Text>
        </View>
      ) : !project ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Project not found</Text>
          <Button
            title="Go Back"
            variant="primary"
            size="medium"
            onPress={() => navigation.goBack()}
          />
        </View>
      ) : projectChats.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Icon name="message-circle" size={28} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptyText}>
            {hasModels
              ? 'Start a new conversation for this project.'
              : 'Download a model to start chatting.'}
          </Text>
          {hasModels && (
            <Button
              title="New Chat"
              variant="primary"
              size="medium"
              onPress={handleNewChat}
            />
          )}
        </View>
      ) : (
        <FlatList
          data={projectChats}
          renderItem={renderChat}
          keyExtractor={chatKey}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== 'android'}
        />
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};
