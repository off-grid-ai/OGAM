import React, { useState } from 'react';
import {
  StyleSheet, View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useChatOptions } from '../components/ChatOptions';
import { useChatPrefs, useVaultSession, visibleConversations } from '../atlasTools/chatPrefs';
import Icon from 'react-native-vector-icons/Feather';
import { projectType } from '../projects/projectTypes';
import { Button } from '../components/Button';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './ProjectDetailScreen.styles';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { isChatUnlocked } from '../stores/encryptedChatStorage';
import { isProtectedProjectUnlocked } from '../stores/protectedProjectStorage';
import { Conversation } from '../types';
import { RootStackParamList } from '../navigation/types';
import { KnowledgeBaseSection } from './ProjectDetailKnowledgeBaseSection';
import { isTextDocument } from '../services/rag/textDocument';
import { LanguageCourseCard } from '../language/LanguageCourseCard';
import { ProjectPinGate } from '../components/ProjectPinGate';
import { useActiveTextModel } from '../hooks/useActiveTextModel';
import { useTopics } from '../topics/store';
const COLOR_FFF = '#fff';
const COLOR_RGBA_255_255_255_0_85 = 'rgba(255,255,255,0.85)';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 12 },
  s2: { marginLeft: 12, flex: 1 },
  s3: { color: COLOR_FFF, fontWeight: '700', fontSize: 15 },
  s4: { color: COLOR_RGBA_255_255_255_0_85, fontSize: 12 },
  s5: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: 12, borderWidth: 1 },
  s6: { fontSize: 15 },
  s7: { fontSize: 12 },
});


type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { getProject, deleteProject } = useProjectStore();
  const { conversations, setActiveConversation, createConversation } = useChatStore();
  const hideLocked = useChatPrefs(s => s.hideLockedChats);
  const vaultOpen = useVaultSession(s => s.open);
  const chatOptions = useChatOptions();
  const { downloadedModels, activeModelId } = useAppStore();

  const project = getProject(projectId);
  const projectCourses = useTopics((st) => st.courses.filter((c) => c.projectId === projectId).length);
  // A connected remote model (Ollama, LM Studio...) counts, as it does on Home and in the chat list.
  const { modelId: activeTextModelId } = useActiveTextModel();
  const hasModels = downloadedModels.length > 0 || !!activeTextModelId;

  // Get chats for this project
  const projectChats = visibleConversations(conversations, hideLocked, vaultOpen)
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = (starter?: string) => {
    if (project?.pinVerifier && !isProtectedProjectUnlocked(project.id)) {
      setAlertState(showAlert('Protected project', 'Unlock this project to start a chat in it. New chats are encrypted with the project PIN.'));
      return;
    }
    if (!hasModels) {
      setAlertState(showAlert('No Model', 'Please download a model first from the Models tab.'));
      return;
    }
    const modelId = activeTextModelId || activeModelId || downloadedModels[0]?.id;
    if (modelId) {
      const newConversationId = createConversation(modelId, undefined, projectId);
      navigation.navigate('Chat', { conversationId: newConversationId, projectId, ...(starter ? { starter } : {}) });
    }
  };

  const handleDeleteProject = () => {
    setAlertState(showAlert(
      'Delete Project',
      `Delete "${project?.name}"? This will not delete the chats associated with this project.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject(projectId);
            navigation.goBack();
          },
        },
      ]
    ));
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

  const renderChat = ({ item }: { item: Conversation }) => {
    const lastMessage = item.messages[item.messages.length - 1];

    return (
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleChatPress(item)}
          onLongPress={() => chatOptions.open(item)}
        >
          <View style={styles.chatIcon}>
            <Icon name="message-circle" size={14} color={colors.textMuted} />
          </View>
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {item.pinVerifier && !isChatUnlocked(item.id) ? 'Locked conversation' : item.title}
              </Text>
              <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            {item.pinVerifier && !isChatUnlocked(item.id) ? <Text style={styles.chatPreview}>PIN required</Text> : lastMessage && (
              <Text style={styles.chatPreview} numberOfLines={1}>
                {lastMessage.role === 'user' ? 'You: ' : ''}{lastMessage.content}
              </Text>
            )}
          </View>
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </TouchableOpacity>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProjectPinGate projectId={projectId} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.projectIcon}>
            <Text style={styles.projectIconText}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('ProjectEdit', { projectId })} style={styles.editButton}>
          <Icon name="edit-2" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {project.course === 'language' && <LanguageCourseCard />}

      {projectType(project.kind).starts.length > 0 && (
        <View style={styles.startsWrap} testID="project-quick-starts">
          <Text style={styles.startsLabel}>{projectType(project.kind).name} quick starts</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.startsRow}>
            {projectType(project.kind).starts.map((q) => (
              <TouchableOpacity key={q.label} style={styles.start} onPress={() => handleNewChat(q.prompt)} testID={`project-start-${q.label.toLowerCase().replace(/\s+/g, '-')}`} accessibilityLabel={`${q.label}: start a chat`}>
                <Icon name={q.icon} size={14} color={colors.primary} />
                <Text style={styles.startText}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Atlas: NotebookLM-style study tools for this project's documents */}
      <TouchableOpacity
        onPress={() => navigation.navigate('Study', { projectId })}
        style={[literalStyles.s1, { backgroundColor: colors.primary }]}
      >
        <Icon name="book-open" size={20} color="#fff" />
        <View style={literalStyles.s2}>
          <Text style={literalStyles.s3}>Study</Text>
          <Text style={literalStyles.s4}>Ask with sources, study guide, flashcards, quiz, mind map, podcast, video</Text>
        </View>
        <Icon name="chevron-right" size={18} color="#fff" />
      </TouchableOpacity>

      {/* Courses: a subject learned on a board, built from this project's documents */}
      <TouchableOpacity
        onPress={() => navigation.navigate('Topics', { projectId, topic: project?.name })}
        style={[literalStyles.s5, { borderColor: colors.primary }]}
        testID="project-courses"
      >
        <Icon name="compass" size={20} color={colors.primary} />
        <View style={literalStyles.s2}>
          <Text style={[{ color: colors.text }, literalStyles.s6]}>Courses{projectCourses ? ` (${projectCourses})` : ''}</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s7]}>Learn this subject on a board, built from the documents in this project</Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.sectionsContainer}>
        {/* Knowledge Base Section */}
        <View style={styles.sectionHalf}>
          <KnowledgeBaseSection
            projectId={projectId}
            colors={colors}
            styles={styles}
            setAlertState={setAlertState}
            onNavigateToKb={() => navigation.navigate('KnowledgeBase', { projectId })}
            onDocumentPress={(doc) => (isTextDocument(doc)
              ? navigation.navigate('ProjectDocument', { projectId, docId: doc.id, name: doc.name })
              : navigation.navigate('DocumentPreview', { filePath: doc.path, fileName: doc.name, fileSize: doc.size }))}
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
                onPress={() => handleNewChat()}
                disabled={!hasModels}
                icon={<Icon name="plus" size={16} color={hasModels ? colors.primary : colors.textDisabled} />}
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
                <Icon name="message-circle" size={24} color={colors.textMuted} />
                <Text style={styles.emptyStateText}>No chats yet</Text>
                {hasModels && (
                  <Button
                    title="Start a Chat"
                    variant="primary"
                    size="small"
                    onPress={() => handleNewChat()}
                    style={styles.emptyStateButton}
                  />
                )}
              </View>
            ) : (
              projectChats.map((chat) => (
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
      {chatOptions.element}
    </SafeAreaView >
  );
};