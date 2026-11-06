import { deleteChatImages, imagesNotDeletedAlert } from '../services/chatImageCleanup';
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
import { AliveScreen } from '../components/AliveScreen';
import { useNavigation, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
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
import { createStyles } from './ProjectDetailScreen.styles';
import { useChatStore, useProjectStore, useAppStore, useRemoteServerStore } from '../stores';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';
import { SectionLabel } from '../components/SectionLabel';
import { useProjectDocumentCounts } from '../hooks/useProjectDocumentCounts';
import { formatWhen } from '../utils/localTime';
import { useConversationPreviewLine } from '../hooks/useConversationPreviewLine';
import { byRecentActivity } from '../utils/conversationOrdering';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';
import { chatTitle } from '../utils/chatTitle';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const previewLine = useConversationPreviewLine();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const isFocused = useIsFocused();
  const projectIds = useMemo(() => [projectId], [projectId]);
  const fileCount = useProjectDocumentCounts(projectIds, isFocused)[projectId] ?? 0;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

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
      setAlertState(
        showAlert(
          'No Model',
          'Please download a model first from the Models tab.',
        ),
      );
      return;
    }
    const modelId = activeModelId || downloadedModels[0]?.id;
    if (modelId) {
      const newConversationId = createConversation(
        modelId,
        undefined,
        projectId,
      );
      navigation.navigate('Chat', {
        conversationId: newConversationId,
        projectId,
      });
    }
  };

  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(
      showAlert('Delete Chat', `Delete "${conversation.title}"?`, [
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
      ]),
    );
  };

  const formatDate = (dateString: string): string => formatWhen(dateString);

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
          {/* Title, date, preview: as the Chats list. A chat glyph on every row and a chevron under
              the date said nothing the row did not (hand test 33). */}
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {chatTitle(item.title)}
              </Text>
              <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            {/* Always the second line, empty or not, so every row is the same height. */}
            <Text style={styles.chatPreview} numberOfLines={1}>
              {preview || ' '}
            </Text>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (!project) {
    return (
      <AliveScreen style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Project not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.errorLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </AliveScreen>
    );
  }

  const instructionsLine = project.systemPrompt?.trim().split('\n')[0] ?? '';
  const hasPurpose = !!project.description?.trim()
    && project.description.trim().toLowerCase() !== project.name.trim().toLowerCase();

  return (
    <AliveScreen style={styles.container} testID="project-detail-screen">
      {/* Header: back, the name, edit. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.name}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('ProjectEdit', { projectId })}
          style={styles.editButton}
          accessibilityRole="button"
          accessibilityLabel="Edit project"
        >
          <Icon name="edit-2" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* What it is for, beside the page's one main action, as on Home. */}
      <View style={styles.purposeRow}>
        <Text style={styles.projectPurpose} numberOfLines={2}>
          {hasPurpose ? project.description.trim() : 'Chats here share these instructions and files.'}
        </Text>
        {hasModels ? (
          <Button
            title="New chat"
            variant="hero"
            size="small"
            icon={<Icon name="plus" size={16} color={colors.onHero} />}
            onPress={handleNewChat}
            style={styles.newChatButton}
            testID="project-new-chat"
          />
        ) : null}
      </View>

      {/* What makes this a project: its instructions and its files, in view rather than behind a tab
          (screen review). Each row opens its own screen. */}
      <View style={styles.knowsGroup}>
        <TouchableOpacity
          style={styles.knowsRow}
          onPress={() => navigation.navigate('ProjectEdit', { projectId })}
          accessibilityRole="button"
          accessibilityLabel={instructionsLine ? `Instructions: ${instructionsLine}` : 'Add instructions'}
          testID="project-instructions"
        >
          <Icon name="align-left" size={16} color={colors.textSecondary} />
          <View style={styles.knowsText}>
            <Text style={styles.knowsTitle}>{instructionsLine ? 'Instructions' : 'Add instructions'}</Text>
            <Text style={styles.knowsDesc} numberOfLines={1}>
              {instructionsLine || 'Tell every chat here how to answer.'}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.knowsRow, styles.knowsRowDivided]}
          onPress={() => navigation.navigate('KnowledgeBase', { projectId })}
          accessibilityRole="button"
          accessibilityLabel={fileCount > 0 ? `${fileCount} files` : 'Add a file'}
          testID="project-files"
        >
          <Icon name="file-text" size={16} color={colors.textSecondary} />
          <View style={styles.knowsText}>
            <Text style={styles.knowsTitle} testID="project-knowledge-base-count">
              {fileCount === 0 ? 'Add a file' : fileCount === 1 ? '1 file' : `${fileCount} files`}
            </Text>
            <Text style={styles.knowsDesc} numberOfLines={1}>
              {fileCount === 0 ? 'Chats here answer from it.' : 'Chats here answer from these.'}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {projectChats.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Start a chat. It uses these instructions and files.</Text>
        </View>
      ) : (
        <>
          <SectionLabel title={`Chats · ${projectChats.length}`} style={styles.chatsLabel} testID="project-chats-count" />
          <FlatList
            {...SCROLL_DEPTH_PROPS}
            style={styles.sectionList}
            // The chats on one surface with hairlines, as on Chats (hand test 61: bare rows on the field).
            contentContainerStyle={styles.chatGroup}
            data={projectChats}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={styles.chatItemWrapper}>{renderChat({ item })}</View>
            )}
            {...LIST_CLIPPING_PROPS}
          />
        </>
      )}

      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </AliveScreen>
  );
};
