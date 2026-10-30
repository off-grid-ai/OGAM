import React from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { TouchableOpacity } from './Touchable';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Project } from '../types';

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
      sheet="project-selector"
      visible={visible}
      onClose={onClose}
      snapPoints={['45%']}
      title="Select Project"
    >
      <ScrollView
        style={styles.projectList}
        contentContainerStyle={styles.projectListContent}
      >
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
            style={[
              styles.projectOption,
              activeProject?.id === project.id && styles.projectOptionSelected,
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
                {project.description}
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
    // Deliberately unpadded. Padding on a ScrollView's `style` pads the VIEWPORT, not the content,
    // so the last project sat flush against the bottom edge of the phone with nothing below it and
    // its subtitle clipped by the frame. Inner spacing belongs to the content container.
    flexGrow: 0,
  },
  projectListContent: {
    padding: SPACING.lg,
    // Room past the last row for the home indicator, so the final project is fully readable when
    // the list is scrolled to the end.
    paddingBottom: SPACING.xxl,
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
