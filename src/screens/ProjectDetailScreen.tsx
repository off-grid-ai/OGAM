import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Platform } from 'react-native';
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
import { useChatStore } from '../stores';
import {
  chatListPreviewLine,
  workflowFailureMessage,
  type ConversationRecord,
  type MessageRecord,
} from '@offgrid/application';
import { RootStackParamList } from '../navigation/types';
import { portableMessageText } from '../utils/portableMessageText';
import { KnowledgeBaseSection } from './ProjectDetailKnowledgeBaseSection';
import { formatWhen } from '../utils/localTime';
import { useActiveMobileModel } from '../hooks/useActiveMobileModel';
import { useMobileModelInventory } from '../hooks/useMobileModelInventory';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import { applicationFacade } from '../services/applicationFacade';
import {
  describeWorkspaceContentFailure,
  useWorkspaceContentCommands,
} from '../hooks/useWorkspaceContentCommands';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectDetail'>;

const chatKey = (conversation: ConversationRecord): string => conversation.id;

function deleteChatWithAlert(
  conversation: ConversationRecord,
  setAlertState: (state: AlertState) => void,
): void {
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
}

function latestMessages(
  messages: readonly MessageRecord[],
): Map<string, MessageRecord> {
  const latest = new Map<string, MessageRecord>();
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
}

const ProjectAvailability: React.FC<{
  status: ReturnType<typeof useWorkspaceContentProjection>['status'];
  missing: boolean;
  onBack: () => void;
  styles: ReturnType<typeof createStyles>;
}> = ({ status, missing, onBack, styles }) => (
  <SafeAreaView style={styles.container} edges={['top']}>
    <View style={styles.errorContainer}>
      <Text style={styles.errorText}>
        {status !== 'ready'
          ? status === 'stopped'
            ? 'Project unavailable'
            : 'Loading project…'
          : 'Project not found'}
      </Text>
      {missing ? (
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.errorLink}>Go back</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  </SafeAreaView>
);

export const ProjectDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const workspaceContent = useWorkspaceContentProjection();
  const { conversations, messages, projects, status } = workspaceContent;
  const { execute } = useWorkspaceContentCommands();
  const project = projects.find(item => item.id === projectId);
  const setActiveConversation = useChatStore(
    state => state.setActiveConversation,
  );
  const activeText = useActiveMobileModel('text').model;
  const textModels = useMobileModelInventory('text');

  const hasModels = textModels.length > 0;

  const lastMessageByConversation = useMemo(
    () => latestMessages(messages),
    [messages],
  );
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
    const modelId = activeText?.id ?? textModels[0]?.id;
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
              try {
                const outcome =
                  await applicationFacade().workflows.deleteProject(projectId);
                if (!outcome.ok) {
                  setAlertState(
                    showAlert(
                      'Project Not Deleted',
                      workflowFailureMessage(outcome.failure),
                    ),
                  );
                  return;
                }
                navigation.goBack();
              } catch (error: unknown) {
                setAlertState(
                  showAlert(
                    'Project Not Deleted',
                    error instanceof Error
                      ? error.message
                      : 'Failed to delete project',
                  ),
                );
              }
            },
          },
        ],
      ),
    );
  };

  const handleDeleteChat = (conversation: ConversationRecord) =>
    deleteChatWithAlert(conversation, setAlertState);

  const formatDate = (dateString: string): string => formatWhen(dateString);

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
      <View style={styles.chatItemWrapper}>
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
                <Text style={styles.chatDate}>
                  {formatDate(item.updatedAt)}
                </Text>
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
      </View>
    );
  };

  if (status !== 'ready' || !project) {
    return (
      <ProjectAvailability
        status={status}
        missing={status === 'ready'}
        onBack={() => navigation.goBack()}
        styles={styles}
      />
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
      testID="project-detail-screen"
    >
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

          {projectChats.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="message-circle" size={24} color={colors.textMuted} />
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
            <FlatList
              style={styles.sectionList}
              data={projectChats}
              renderItem={renderChat}
              keyExtractor={chatKey}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={Platform.OS !== 'android'}
            />
          )}
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
