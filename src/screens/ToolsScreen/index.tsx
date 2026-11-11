import React from 'react';
import { useWideLayout } from '../../hooks/useWideLayout';
import { WebSearchSettings } from '../../components/WebSearchSettings';
import { View, Text, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../../constants';
import { AVAILABLE_TOOLS } from '../../services/tools';
import { useAppStore, useChatStore } from '../../stores';
import { useAgentStore } from '../../stores/agentStore';
import { resetChatTools, toggleChatTool, toolSourceFor, toolsForConversation, setChatToolGroup, withGroup, groupIsOn, TOOL_GROUPS, PROJECT_TOOL_IDS } from '../../services/tools/chatTools';
import type { ThemeColors, ThemeShadows } from '../../theme';

/**
 * Full-page tool picker (replaces the old bottom-sheet drawer). Lists the
 * built-in tools as switches, plus permission groups at the top.
 */
export const ToolsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const wide = useWideLayout();
  const styles = useThemedStyles(createStyles);

  // Opened from a chat: the switches change that chat's tools only. From Settings: the app defaults.
  const conversationId = (useRoute().params as { conversationId?: string } | undefined)?.conversationId;
  const conv = useChatStore(st => (conversationId ? st.conversations.find(c => c.id === conversationId) : undefined));
  const agentName = useAgentStore(st => st.agents.find(a => a.id === conv?.agentId)?.name);
  const appTools = useAppStore(st => st.settings.enabledTools);
  const enabledTools = conv ? toolsForConversation(conv) : appTools || [];
  const source = conv ? toolSourceFor(conv) : null;
  const updateSettings = useAppStore(st => st.updateSettings);

  const handleToggleTool = (toolId: string) => {
    if (conv) { toggleChatTool(conv.id, toolId); return; }
    const cur = useAppStore.getState().settings.enabledTools || [];
    updateSettings({
      enabledTools: cur.includes(toolId) ? cur.filter(id => id !== toolId) : [...cur, toolId],
    });
  };

  const inProject = !conv || !!conv.projectId;
  const shownTools = AVAILABLE_TOOLS.filter(t => inProject || !PROJECT_TOOL_IDS.includes(t.id));
  const toggleGroup = (tools: string[], on: boolean) => {
    if (conv) { setChatToolGroup(conv.id, tools, on); return; }
    updateSettings({ enabledTools: withGroup(useAppStore.getState().settings.enabledTools || [], tools, on) });
  };
  const allGroupTools = TOOL_GROUPS.flatMap(g => g.tools);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{conv ? 'Tools for this chat' : 'Default tools'}</Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={[styles.contentContainer, wide.column]}>
        

        <View style={styles.scopeNote} testID="tools-scope">
          <Text style={styles.toolDescription}>
            {!conv ? 'New chats start with these tools, unless their agent has its own (Agents -> edit -> Tools).'
              : source === 'chat' ? 'This chat has its own tools. Other chats are not changed.'
                : `Using ${source === 'agent' ? `${agentName ?? 'the agent'}'s default tools` : 'the default tools'}. Changing one here changes this chat only.`}
          </Text>
          {source === 'chat' && (
            <TouchableOpacity onPress={() => resetChatTools(conv!.id)} testID="tools-reset">
              <Text style={styles.scopeReset}>Use {conv?.agentId && agentName ? `${agentName}'s` : 'the default'} tools again</Text>
            </TouchableOpacity>
          )}
        </View>

        <View testID="tool-groups" style={styles.scopeNote}>
          <Text style={styles.toolName}>Permissions in one tap</Text>
          <Text style={styles.toolDescription}>
            Turn on what this {conv ? 'chat' : 'app'} may use. Atlas only gives the model the tools a message could need, so you can leave many on.
            {conv && !conv.projectId ? ' Study, maths and project-document tools are used inside projects only.' : ''}
          </Text>
          {TOOL_GROUPS.map(g => {
            const on = groupIsOn(g.tools, enabledTools);
            return (
              <View key={g.id} style={styles.toolRow} testID={`tool-group-${g.id}`}>
                <View style={styles.toolInfo}>
                  <Text style={styles.toolName}>{g.label}</Text>
                  <Text style={styles.toolDescription}>{g.hint}</Text>
                </View>
                <Switch value={on} onValueChange={(v) => toggleGroup(g.tools, v)}
                  trackColor={{ false: colors.border, true: `${colors.primary}80` }} thumbColor={on ? colors.primary : colors.textMuted} />
              </View>
            );
          })}
          <View style={styles.toolRow} testID="tool-group-all">
            <View style={styles.toolInfo}>
              <Text style={styles.toolName}>Everything above</Text>
            </View>
            <Switch value={groupIsOn(allGroupTools, enabledTools)} onValueChange={(v) => toggleGroup(allGroupTools, v)}
              trackColor={{ false: colors.border, true: `${colors.primary}80` }} thumbColor={colors.primary} />
          </View>
        </View>

        <WebSearchSettings />


        {shownTools.map(tool => {
          const isEnabled = enabledTools.includes(tool.id);
          return (
            <View key={tool.id} style={styles.toolRow} testID={`tool-picker-row-${tool.id}`}>
              <View style={styles.toolIcon}>
                <Icon name={tool.icon} size={20} color={isEnabled ? colors.primary : colors.textMuted} />
              </View>
              <View style={styles.toolInfo}>
                <View style={styles.toolNameRow}>
                  <Text style={styles.toolName} testID={`tool-picker-name-${tool.id}`}>{tool.displayName}</Text>
                  {tool.requiresNetwork && (
                    <Icon name="wifi" size={12} color={colors.textMuted} style={styles.networkIcon} />
                  )}
                </View>
                <Text style={styles.toolDescription}>{tool.description}</Text>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={() => handleToggleTool(tool.id)}
                trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                thumbColor={isEnabled ? colors.primary : colors.textMuted}
              />
            </View>
          );
        })}
        <Text style={styles.hint}>
          Each message is sent with only the tools it could use, so more switches on does not slow replies.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    marginRight: SPACING.md,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    fontSize: 18,
    color: colors.text,
    flex: 1,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  proToolsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  proToolsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${colors.primary}20`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  toolRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  toolInfo: {
    flex: 1,
    marginRight: 12,
  },
  toolNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  toolName: {
    fontSize: 15,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    color: colors.text,
  },
  networkIcon: {
    marginLeft: 6,
  },
  toolDescription: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    marginTop: 2,
  },
  scopeNote: { marginBottom: SPACING.md, gap: SPACING.xs },
  scopeReset: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
  hint: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
  },
});
