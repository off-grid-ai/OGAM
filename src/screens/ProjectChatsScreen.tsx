import { deleteChatImages, imagesNotDeletedAlert } from '../services/chatImageCleanup';
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
} from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
import { AliveScreen } from '../components/AliveScreen';
import { ListGroupSeparator, listGroupRowEnds } from '../components/ListGroup';
import { cardSurface } from '../theme/surface';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { formatWhen } from '../utils/localTime';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useChatStore, useProjectStore, useAppStore, useRemoteServerStore } from '../stores';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';
import { byRecentActivity } from '../utils/conversationOrdering';
import { useConversationPreviewLine } from '../hooks/useConversationPreviewLine';
import { chatTitle } from '../utils/chatTitle';
import { ScreenHeader } from '../components/ScreenHeader';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectChats'>;

const formatDate = (dateString: string): string => formatWhen(dateString);

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
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
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
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
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  // The chats are rows of one surface with hairlines (ListGroup), like Chats.
  chatItem: {
    ...cardSurface(colors),
    borderRadius: 0,
    borderWidth: 0,
    boxShadow: [],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  chatIcon: { marginRight: SPACING.md },
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
  const previewLine = useConversationPreviewLine();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const project = useProjectStore(state => state.projects.find(p => p.id === projectId));
  const conversations = useChatStore(state => state.conversations);
  const deleteConversation = useChatStore(state => state.deleteConversation);
  const setActiveConversation = useChatStore(state => state.setActiveConversation);
  const createConversation = useChatStore(state => state.createConversation);
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const activeModelId = useAppStore(state => state.activeModelId);

  const activeVideoModelId = useAppStore(s => s.activeVideoModelId);
  const remoteVideoServerId = useRemoteServerStore(s => s.activeRemoteMediaServerIds.video);
  const hasVideoModel = !!activeVideoModelId || !!remoteVideoServerId;
  const hasModels = downloadedModels.length > 0 || hasVideoModel;

  // Get chats for this project
  const projectChats = useMemo(
    () => byRecentActivity(conversations.filter(c => c.projectId === projectId)),
    [conversations, projectId],
  );

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = () => {
    if (hasVideoModel && downloadedModels.length === 0) {
      navigation.navigate('Chat', { projectId });
      return;
    }
    if (!hasModels) {
      setAlertState(showAlert('No Model', 'Please download a model first from the Models tab.'));
      return;
    }
    const modelId = activeModelId || downloadedModels[0]?.id;
    if (modelId) {
      const newConversationId = createConversation(modelId, undefined, projectId);
      navigation.navigate('Chat', { conversationId: newConversationId, projectId });
    }
  };

  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(showAlert(
      'Delete Chat',
      `Delete "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            const notDeleted = await deleteChatImages(conversation.id);
            deleteConversation(conversation.id);
            if (notDeleted > 0) setAlertState(imagesNotDeletedAlert(notDeleted));
          },
        },
      ]
    ));
  };

  const renderChatRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${conversation.title}`}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const renderChat = ({ item, index }: { item: Conversation; index: number }) => {
    const preview = previewLine(item.messages);

    return (
      <Swipeable
        renderRightActions={() => renderChatRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <TouchableOpacity
          style={[styles.chatItem, listGroupRowEnds(index, projectChats.length)]}
          onPress={() => handleChatPress(item)}
        >
          <Icon name="message-circle" size={15} color={colors.textMuted} style={styles.chatIcon} />
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {chatTitle(item.title)}
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
    <AliveScreen style={styles.container}>
      <ScreenHeader
        title={project?.name || 'Chats'}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            onPress={handleNewChat}
            style={styles.addButton}
            disabled={!hasModels}
            accessibilityRole="button"
            accessibilityLabel="New chat"
          >
            <Icon name="plus" size={20} color={hasModels ? colors.text : colors.textMuted} />
          </TouchableOpacity>
        }
      />

      {projectChats.length === 0 ? (
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
              title="New chat"
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
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={ListGroupSeparator}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          {...LIST_CLIPPING_PROPS}
        />
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </AliveScreen>
  );
};
