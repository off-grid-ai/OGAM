import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { ScreenHeader } from '../components/ScreenHeader';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import { workflowFailureMessage, type ProjectRecord } from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';
import { RootStackParamList, MainTabParamList } from '../navigation/types';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ProjectsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const ProjectsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { projects, conversations } = useWorkspaceContentProjection();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const chatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const conversation of conversations) {
      if (conversation.projectId === null) continue;
      counts[conversation.projectId] = (counts[conversation.projectId] ?? 0) + 1;
    }
    return counts;
  }, [conversations]);

  const handleProjectPress = (project: ProjectRecord) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleDeleteProject = (project: ProjectRecord) => {
    setAlertState(showAlert(
      'Delete Project',
      `Delete "${project.name}"? This will not delete the chats associated with this project.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            try {
              const outcome = await applicationFacade().workflows.deleteProject(project.id);
              if (!outcome.ok) {
                setAlertState(
                  showAlert('Project Not Deleted', workflowFailureMessage(outcome.failure)),
                );
                return;
              }
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
      ]
    ));
  };

  const renderRightActions = (project: ProjectRecord) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteProject(project)}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const handleNewProject = () => {
    navigation.navigate('ProjectEdit', {});
  };

  const renderProject = ({ item, index }: { item: ProjectRecord; index: number }) => {
    const chatCount = chatCounts[item.id] ?? 0;

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <AnimatedListItem
          index={index}
          trigger={focusTrigger}
          style={styles.projectItem}
          onPress={() => handleProjectPress(item)}
          testID={`project-row-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          accessibilityHint={
            item.description
              ? `${chatCount} chats. ${item.description}`
              : `${chatCount} chats`
          }
        >
          <View style={styles.projectIcon}>
            <Text style={styles.projectIconText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.projectContent}>
            <View style={styles.projectNameRow}>
              <Text style={styles.projectName} numberOfLines={1}>{item.name}</Text>
              <View style={styles.chatCountTag}>
                <Icon name="message-circle" size={8} color={colors.textMuted} />
                <Text style={styles.chatCountText}>{chatCount}</Text>
              </View>
            </View>
            {item.description ? (
              <Text style={styles.projectDescription} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </AnimatedListItem>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="projects-screen">
      <ScreenHeader
        title="Projects"
        variant="tab"
        right={
          <Button
            title="New"
            variant="primary"
            size="small"
            onPress={handleNewProject}
            icon={<Icon name="plus" size={16} color={colors.primary} />}
            testID="new-project-button"
          />
        }
      />

      <Text style={styles.subtitle}>
        Projects group related chats with shared context and instructions.
      </Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <AnimatedEntry index={0} staggerMs={60} trigger={focusTrigger}>
            <View style={styles.emptyIcon}>
              <Icon name="folder" size={20} color={colors.textMuted} />
            </View>
          </AnimatedEntry>
          <AnimatedEntry index={1} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyTitle}>No Projects Yet</Text>
          </AnimatedEntry>
          <AnimatedEntry index={2} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyText}>
              Create a project to organize your chats by topic, like "Spanish Learning" or "Code Review".
            </Text>
          </AnimatedEntry>
          <AnimatedEntry index={3} staggerMs={60} trigger={focusTrigger}>
            <TouchableOpacity style={styles.emptyButton} onPress={handleNewProject} testID="new-project-empty-button">
              <Icon name="plus" size={14} color={colors.primary} />
              <Text style={styles.emptyButtonText}>Create Project</Text>
            </TouchableOpacity>
          </AnimatedEntry>
        </View>
      ) : (
        <FlatList
          data={projects}
          renderItem={renderProject}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== 'android'}
        />
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
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
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  list: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  projectItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 10,
    marginBottom: SPACING.sm,
    ...shadows.small,
  },
  projectIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm,
  },
  projectIconText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  projectContent: {
    flex: 1,
  },
  projectNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  projectName: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    fontWeight: '400' as const,
    flexShrink: 1,
  },
  projectDescription: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: 1,
  },
  chatCountTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: SPACING.sm,
    flexShrink: 0,
  },
  chatCountText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
    marginBottom: SPACING.xl,
  },
  emptyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 6,
    gap: SPACING.sm,
  },
  emptyButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 50,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    marginLeft: 10,
  },
});
