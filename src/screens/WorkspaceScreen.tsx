/* eslint-disable react-native/no-inline-styles -- Small workspace segment control computes active colors from theme. */
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { ProjectsScreen } from './ProjectsScreen';
import { AgentsScreen } from './AgentsScreen';
import { useLayoutClass } from '../hooks/useLayoutClass';

type WorkspaceSection = 'projects' | 'agents';

/** One destination for both projects and agent personas: tabs on phones, two panes on large tablets. */
export const WorkspaceScreen: React.FC = () => {
  const [section, setSection] = useState<WorkspaceSection>('projects');
  const { colors } = useTheme();
  const { twoPane } = useLayoutClass();
  if (twoPane) {
    // Large tablet: both lists stay visible side by side (each screen keeps its own header).
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
        <View testID="workspace-two-pane" style={{ flex: 1, flexDirection: 'row' }}>
          {(['projects', 'agents'] as const).map((key, index) => (
            <View key={key} testID={`workspace-pane-${key}`} style={{
              flex: 1, borderLeftWidth: index ? 1 : 0, borderLeftColor: colors.border,
            }}>
              {key === 'projects' ? <ProjectsScreen embedded /> : <AgentsScreen embedded />}
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16,
        paddingTop: 8, paddingBottom: 5, gap: 8, backgroundColor: colors.background }}>
        {(['projects', 'agents'] as const).map(key => (
          <TouchableOpacity key={key} testID={`workspace-${  key}`}
            accessibilityRole="tab" accessibilityState={{ selected: section === key }}
            onPress={() => setSection(key)}
            style={{
              flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10,
              backgroundColor: section === key ? colors.primary : colors.surface,
              borderWidth: 1, borderColor: section === key ? colors.primary : colors.border,
            }}>
            <Text style={{ fontWeight: '600', color: section === key ? colors.background : colors.text }}>
              {key === 'projects' ? 'Projects' : 'Agents & pals'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {section === 'projects' ? <ProjectsScreen embedded /> : <AgentsScreen embedded />}
      </View>
    </SafeAreaView>
  );
};
