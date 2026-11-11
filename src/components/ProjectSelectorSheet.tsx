import React from 'react';
import {
  StyleSheet, View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Project } from '../types';
import { isProtectedProjectUnlocked } from '../stores/protectedProjectStorage';
const literalStyles = StyleSheet.create({
  s1: { opacity: 0.45 },
});


/** A protected project accepts chats only while it is unlocked. */
const isLockedProject = (p: { id: string; pinVerifier?: string }) => !!p.pinVerifier && !isProtectedProjectUnlocked(p.id);

interface ProjectSelectorSheetProps {
  visible: boolean;
  onClose: () => void;
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (project: Project | null) => void;
}

export const ProjectSelectorSheet: React.FC<ProjectSelectorSheetProps> = ({
  visible,
  onClose,
  projects,
  activeProject,
  onSelectProject,
}) => {
  const styles = useThemedStyles(createStyles);

  const handleSelect = (project: Project | null) => {
    onSelectProject(project);
    onClose();
  };

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['45%']}
      title="Select Project"
    >
      <ScrollView style={styles.projectList}>
        {/* Default option */}
        <TouchableOpacity
          style={[
            styles.projectOption,
            !activeProject && styles.projectOptionSelected,
          ]}
          onPress={() => handleSelect(null)}
        >
          <View style={styles.projectOptionIcon}>
            <Text style={styles.projectOptionIconText}>D</Text>
          </View>
          <View style={styles.projectOptionInfo}>
            <Text style={styles.projectOptionName}>Default</Text>
            <Text style={styles.projectOptionDesc} numberOfLines={1}>
              Use default system prompt from settings
            </Text>
          </View>
          {!activeProject && (
            <Text style={styles.projectCheckmark}>✓</Text>
          )}
        </TouchableOpacity>

        {projects.map((project) => (
          <TouchableOpacity
            key={project.id}
            disabled={isLockedProject(project)}
            style={[
              styles.projectOption,
              activeProject?.id === project.id && styles.projectOptionSelected,
              isLockedProject(project) && literalStyles.s1,
            ]}
            onPress={() => handleSelect(project)}
          >
            <View style={styles.projectOptionIcon}>
              <Text style={styles.projectOptionIconText}>
                {project.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.projectOptionInfo}>
              <Text style={styles.projectOptionName}>{project.name}</Text>
              <Text style={styles.projectOptionDesc} numberOfLines={1}>
                {!project.pinVerifier ? project.description
                  : isLockedProject(project) ? 'Protected project · unlock it to add chats'
                    : 'Protected project · this chat will be encrypted with its PIN'}
              </Text>
            </View>
            {activeProject?.id === project.id && (
              <Text style={styles.projectCheckmark}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  projectList: {
    padding: 16,
  },
  projectOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  projectOptionSelected: {
    backgroundColor: `${colors.primary  }20`,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  projectOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: `${colors.primary  }30`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  projectOptionIconText: {
    ...TYPOGRAPHY.h2,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  projectOptionInfo: {
    flex: 1,
  },
  projectOptionName: {
    ...TYPOGRAPHY.h2,
    fontWeight: '600' as const,
    color: colors.text,
  },
  projectOptionDesc: {
    ...TYPOGRAPHY.h3,
    color: colors.textSecondary,
    marginTop: 2,
  },
  projectCheckmark: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600' as const,
    marginLeft: SPACING.sm,
  },
});
