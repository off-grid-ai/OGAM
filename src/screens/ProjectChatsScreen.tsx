import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';
import { useConversationPreviewLine } from '../hooks/useConversationPreviewLine';
import { conversationsForProject } from '../utils/projectConversations';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectChats'>;

const formatDate = (dateString: string): string => formatWhen(dateString);
const chatKey = (conversation: Conversation): string => conversation.id;

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
  const previewLine = useConversationPreviewLine();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const project = useProjectStore(state =>
    state.projects.find(candidate => candidate.id === projectId),
  );
  const conversations = useChatStore(state => state.conversations);
  const deleteConversation = useChatStore(state => state.deleteConversation);
  const setActiveConversation = useChatStore(state => state.setActiveConversation);
  const createConversation = useChatStore(state => state.createConversation);
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const activeModelId = useAppStore(state => state.activeModelId);

  const hasModels = downloadedModels.length > 0;

  // Get chats for this project
  const projectChats = useMemo(
    () => conversationsForProject(conversations, projectId),
    [conversations, projectId],
  );

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = () => {
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
          onPress: () => deleteConversation(conversation.id),
        },
      ]
    ));
  };

  const renderChatRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteChat(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const renderChat = ({ item }: { item: Conversation }) => {
    const preview = previewLine(item.messages);

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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project?.name || 'Chats'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleNewChat} style={styles.addButton} disabled={!hasModels}>
          <Icon name="plus" size={20} color={hasModels ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </View>

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
