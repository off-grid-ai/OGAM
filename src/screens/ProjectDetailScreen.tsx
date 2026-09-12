import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { createStyles } from './ProjectDetailScreen.styles';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';
import { KnowledgeBaseSection } from './ProjectDetailKnowledgeBaseSection';
import { formatWhen } from '../utils/localTime';
import { useConversationPreviewLine } from '../hooks/useConversationPreviewLine';
import { conversationsForProject } from '../utils/projectConversations';
import { PROJECT_DELETE_FALLBACK_REASON } from '../stores/projectDeleteOutcome';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const previewLine = useConversationPreviewLine();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const project = useProjectStore(state =>
    state.projects.find(candidate => candidate.id === projectId),
  );
  const deleteProject = useProjectStore(state => state.deleteProject);
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

  const handleDeleteProject = () => {
    setAlertState(
      showAlert(
        'Delete Project',
        `Delete "${project?.name}"? This will not delete the chats associated with this project.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const outcome = await deleteProject(projectId);
              if (outcome.ok) {
                navigation.goBack();
                return;
              }
              setAlertState(
                showAlert(
                  'Project Not Deleted',
                  outcome.reason || PROJECT_DELETE_FALLBACK_REASON,
                ),
              );
            },
          },
        ],
      ),
    );
  };

  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(
      showAlert('Delete Chat', `Delete "${conversation.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConversation(conversation.id),
        },
      ]),
    );
  };

  const formatDate = (dateString: string): string => formatWhen(dateString);

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
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Project not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.errorLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="project-detail-screen">
      {/* Header */}
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
          <View style={styles.projectIcon}>
            <Text style={styles.projectIconText}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.name}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('ProjectEdit', { projectId })}
          style={styles.editButton}
        >
          <Icon name="edit-2" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionsContainer}>
        {/* Knowledge Base Section */}
        <View style={styles.sectionHalf}>
          <KnowledgeBaseSection
            projectId={projectId}
            colors={colors}
            styles={styles}
            setAlertState={setAlertState}
            onNavigateToKb={() =>
              navigation.navigate('KnowledgeBase', { projectId })
            }
            onDocumentPress={doc =>
              navigation.navigate('DocumentPreview', {
                filePath: doc.path,
                fileName: doc.name,
                fileSize: doc.size,
              })
            }
          />
        </View>

        {/* Chats Section */}
        <View style={styles.sectionHalf}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => navigation.navigate('ProjectChats', { projectId })}
            activeOpacity={0.7}
          >
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Chats</Text>
              {projectChats.length > 0 && (
                <Text style={styles.sectionCount}>{projectChats.length}</Text>
              )}
            </View>
            <View style={styles.sectionActions}>
              <Button
                title="New"
                variant="primary"
                size="small"
                onPress={handleNewChat}
                disabled={!hasModels}
                testID="project-new-chat"
                icon={
                  <Icon
                    name="plus"
                    size={16}
                    color={hasModels ? colors.primary : colors.textDisabled}
                  />
                }
              />
              <Icon
                name="chevron-right"
                size={16}
                color={colors.textMuted}
                style={styles.navIcon}
              />
            </View>
          </TouchableOpacity>

          <ScrollView style={styles.sectionList} nestedScrollEnabled>
            {projectChats.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon
                  name="message-circle"
                  size={24}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyStateText}>No chats yet</Text>
                {hasModels && (
                  <Button
                    title="Start a Chat"
                    variant="primary"
                    size="small"
                    onPress={handleNewChat}
                    style={styles.emptyStateButton}
                    testID="project-start-chat"
                  />
                )}
              </View>
            ) : (
              projectChats.map(chat => (
                <View key={chat.id} style={styles.chatItemWrapper}>
                  {renderChat({ item: chat })}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>

      {/* Delete Project Button */}
      <View style={styles.footer}>
        <Button
          title="Delete Project"
          variant="ghost"
          size="medium"
          onPress={handleDeleteProject}
          icon={<Icon name="trash-2" size={16} color={colors.error} />}
          textStyle={{ color: colors.error }}
        />
      </View>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};
