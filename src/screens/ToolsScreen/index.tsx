import React from 'react';
import { AppSwitch } from '../../components/AppSwitch';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { AliveScreen } from '../../components/AliveScreen';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme, useThemedStyles } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { cardSurface } from '../../theme/surface';
import { offeredTools } from '../../services/tools';
import { useAppStore } from '../../stores';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { ScreenHeader } from '../../components/ScreenHeader';


/**
 * Full-page tool picker (replaces the old bottom-sheet drawer). Lists the free
 * core-registry tools as toggles. Pro tools (email/calendar) and MCP servers live
 * on the dedicated Pro Tools destination, reached via the row pinned to the top of
 * the list — for everyone. Free users land on the Pro upsell, pro users go
 * straight to the Pro Tools screen (see useOpenProTools).
 */
export const ToolsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const openProTools = useOpenProTools();

  const enabledTools = useAppStore(st => st.settings.enabledTools) || [];
  const updateSettings = useAppStore(st => st.updateSettings);
  const toolCountHintDismissed = useAppStore(st => st.toolCountHintDismissed);
  const setToolCountHintDismissed = useAppStore(st => st.setToolCountHintDismissed);

  const handleToggleTool = (toolId: string) => {
    const cur = useAppStore.getState().settings.enabledTools || [];
    updateSettings({
      enabledTools: cur.includes(toolId) ? cur.filter(id => id !== toolId) : [...cur, toolId],
    });
  };

  const showHint = enabledTools.length > 3 && !toolCountHintDismissed;

  return (
    <AliveScreen style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title="Tools" onBack={() => navigation.goBack()} backTestID="tools-back" />

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* Pro Tools always sits on top of the listing. */}
        <View style={styles.group}>
        <TouchableOpacity
          style={styles.proToolsButton}
          onPress={openProTools}
          activeOpacity={0.75}
          testID="tools-pro-tools"
        >
          <View style={styles.proToolsIcon}>
            <IconMC name="crown" size={18} color={colors.textSecondary} />
          </View>
          <View style={styles.toolInfo}>
            <Text style={styles.toolName}>Pro tools</Text>
            <Text style={styles.toolDescription}>Email, calendar and MCP servers</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        </View>

        {showHint && (
          <View style={[styles.hintBanner, { backgroundColor: colors.surface }]}>
            <Icon name="info" size={16} color={colors.textMuted} style={styles.hintIcon} />
            <View style={styles.hintBody}>
              <Text style={[styles.hintText, { color: colors.text }]}>
                Too many tools can confuse the model and increase latency on the first response. Stick to 2-3 tools for best results.
              </Text>
              <TouchableOpacity onPress={setToolCountHintDismissed} style={styles.hintDismiss}>
                <Text style={styles.hintDismissText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.group}>
        {offeredTools().map((tool, index) => {
          const isEnabled = enabledTools.includes(tool.id);
          return (
            <View key={tool.id} style={[styles.toolRow, index === 0 && styles.firstRow]} testID={`tool-picker-row-${tool.id}`}>
              <View style={styles.toolIcon}>
                <Icon name={tool.icon} size={18} color={isEnabled ? colors.text : colors.textMuted} />
              </View>
              <View style={styles.toolInfo}>
                <View style={styles.toolNameRow}>
                  <Text style={styles.toolName} testID={`tool-picker-name-${tool.id}`}>{tool.displayName}</Text>
                  {tool.requiresNetwork && (
                    <Icon name="wifi" size={12} color={colors.textMuted} style={styles.networkIcon} />
                  )}
                </View>
                <Text style={styles.toolDescription}>{tool.summary ?? tool.description}</Text>
              </View>
              <AppSwitch
                value={isEnabled}
                onValueChange={() => handleToggleTool(tool.id)}
                accessibilityLabel={tool.displayName}
                testID={`tool-picker-toggle-${tool.id}`}
              />
            </View>
          );
        })}
        </View>
        <Text style={styles.hint}>
          Enabling more tools can confuse the model and increases latency on first response.
        </Text>
      </ScrollView>
    </AliveScreen>
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
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  // One surface with hairlines, as every list (hand test 60: this screen was still the old design).
  group: {
    ...cardSurface(colors),
    overflow: 'hidden' as const,
    marginTop: SPACING.md,
  },
  proToolsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  proToolsIcon: {
    width: 28,
    height: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  toolRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  firstRow: { borderTopWidth: 0 },
  toolIcon: {
    width: 28,
    height: 28,
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
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  networkIcon: {
    marginLeft: 6,
  },
  toolDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  hint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
  },
  hintBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    // A quiet note, not an amber alarm.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: 10,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  hintIcon: {
    marginRight: SPACING.sm,
    marginTop: 1,
  },
  hintBody: {
    flex: 1,
  },
  hintText: {
    ...TYPOGRAPHY.bodySmall,
    lineHeight: 18,
  },
  hintDismiss: {
    marginTop: SPACING.sm,
  },
  hintDismissText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
});
