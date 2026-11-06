import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
} from 'react-native';
import { ListGroupSeparator, listGroupRowEnds, listRowStyle } from '../components/ListGroup';
import { TouchableOpacity } from '../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../constants/listClipping';
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
import { ListSearchBar } from '../components/ListSearchBar';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../constants';
import { formatWhen } from '../utils/localTime';
import { useProjectStore, useChatStore } from '../stores';
import { Project } from '../types';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { PROJECT_DELETE_FALLBACK_REASON } from '../stores/projectDeleteOutcome';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';
import { useIsFocused } from '@react-navigation/native';
import { LivingField } from '../components/LivingField';
import { useProjectDocumentCounts } from '../hooks/useProjectDocumentCounts';

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ProjectsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export const ProjectsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isFocused = useIsFocused();
  const projects = useProjectStore(state => state.projects);
  const deleteProject = useProjectStore(state => state.deleteProject);
  const conversations = useChatStore(state => state.conversations);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [searchQuery, setSearchQuery] = useState('');
  const visibleProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(project =>
      project.name.toLowerCase().includes(query) ||
      (project.description ?? '').toLowerCase().includes(query),
    );
  }, [projects, searchQuery]);

  const { chatCounts, lastUsed } = useMemo(() => {
    const counts: Record<string, number> = {};
    const latest: Record<string, string> = {};
    for (const conversation of conversations) {
      if (conversation.projectId) {
        counts[conversation.projectId] = (counts[conversation.projectId] ?? 0) + 1;
        const previous = latest[conversation.projectId];
        if (!previous || conversation.updatedAt > previous) latest[conversation.projectId] = conversation.updatedAt;
      }
    }
    return { chatCounts: counts, lastUsed: latest };
  }, [conversations]);

  const projectIds = useMemo(() => projects.map(project => project.id), [projects]);
  const documentCounts = useProjectDocumentCounts(projectIds, isFocused);

  const handleProjectPress = (project: Project) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleDeleteProject = (project: Project) => {
    setAlertState(
      showAlert(
        'Delete Project',
        `Delete "${project.name}"? This will not delete the chats associated with this project.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setAlertState(hideAlert());
              const outcome = await deleteProject(project.id);
              if (!outcome.ok) {
                setAlertState(
                  showAlert(
                    'Project Not Deleted',
                    outcome.reason || PROJECT_DELETE_FALLBACK_REASON,
                  ),
                );
              }
            },
          },
        ],
      ),
    );
  };

  const renderRightActions = (project: Project) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteProject(project)}
      accessibilityRole="button"
      accessibilityLabel={`Delete ${project.name}`}
    >
      <Icon name="trash-2" size={16} color={colors.error} />
    </TouchableOpacity>
  );

  const handleNewProject = () => {
    navigation.navigate('ProjectEdit', {});
  };

  const renderProject = ({ item, index }: { item: Project; index: number }) => {
    const chatCount = chatCounts[item.id] ?? 0;
    const documentCount = documentCounts[item.id] ?? 0;
    const when = formatWhen(lastUsed[item.id] ?? item.updatedAt);

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item)}
        overshootRight={false}
        containerStyle={styles.swipeableContainer}
      >
        <AnimatedListItem
          index={index}
          trigger={focusTrigger}
          style={[styles.projectItem, listGroupRowEnds(index, visibleProjects.length)]}
          onPress={() => handleProjectPress(item)}
          testID={`project-row-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          accessibilityHint={`${chatCount} chats, ${documentCount} documents, last used ${when}`}
        >
          {/* Every row the same two lines (screen review: one-line and two-line rows broke the
              list's rhythm): the name, then what is in it and when it was last used. The
              description lives on the project's own page. */}
          <View style={styles.projectContent}>
            <Text style={styles.projectName} numberOfLines={1}>{item.name}</Text>
            <View style={styles.projectStats}>
              <Icon name="message-circle" size={12} color={colors.textMuted} />
              <Text style={styles.projectMeta} testID={`project-chats-${item.id}`}>{chatCount}</Text>
              <Icon name="file-text" size={12} color={colors.textMuted} />
              <Text style={styles.projectMeta} testID={`project-documents-${item.id}`}>{documentCount}</Text>
              <Icon name="clock" size={12} color={colors.textMuted} />
              <Text style={styles.projectMeta}>{when}</Text>
            </View>
          </View>
          <Icon name="chevron-right" size={14} color={colors.textMuted} />
        </AnimatedListItem>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="projects-screen">
      {/* The living field behind the tab, resting while the tab is hidden. */}
      <LivingField active={isFocused} />
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
            <Text style={styles.emptyTitle}>No projects yet</Text>
          </AnimatedEntry>
          <AnimatedEntry index={2} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyText}>
              Keep related chats together, with notes and instructions they all share.
            </Text>
          </AnimatedEntry>
          <AnimatedEntry index={3} staggerMs={60} trigger={focusTrigger}>
            <Button
              title="New project"
              variant="hero"
              size="small"
              icon={<Icon name="plus" size={16} color={colors.onHero} />}
              onPress={handleNewProject}
              testID="new-project-empty-button"
            />
          </AnimatedEntry>
        </View>
      ) : (
        <>
          <ListSearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search projects"
            clearLabel="Clear project search"
            testID="project-search-input"
            style={styles.searchBar}
          />
          <FlatList
            {...SCROLL_DEPTH_PROPS}
            data={visibleProjects}
            renderItem={renderProject}
            ItemSeparatorComponent={ListGroupSeparator}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            {...LIST_CLIPPING_PROPS}
            ListEmptyComponent={<Text style={styles.noMatches}>No projects match your search.</Text>}
            testID="project-list"
          />
        </>
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
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
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  list: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  // The subtitle sits above the search bar, so the bar needs less space on top than on Chats.
  searchBar: {
    paddingTop: SPACING.sm,
  },
  noMatches: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    paddingVertical: SPACING.xxl,
  },
  // A row of the projects group: one surface with hairlines between rows (ListGroupSeparator).
  projectItem: {
    ...listRowStyle,
    paddingVertical: SPACING.sm,
    backgroundColor: colors.surfaceGlass,
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    fontWeight: '400' as const,
    flexShrink: 1,
  },
  projectStats: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 2,
  },
  projectMeta: {
    ...TYPOGRAPHY.metaSmall,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    marginRight: SPACING.sm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
  },
  emptyIcon: {
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
