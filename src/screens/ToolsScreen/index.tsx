import React, { useEffect, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme, useThemedStyles } from '../../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../../constants';
import { AVAILABLE_TOOLS } from '../../services/tools';
import { useAppStore } from '../../stores';
import { usePythonRuntimeStore } from '../../stores/pythonRuntimeStore';
import { pythonRuntimeService } from '../../services/python/pythonRuntimeService';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import type { ThemeColors, ThemeShadows } from '../../theme';

const TOOL_WARNING_COLOR = '#F59E0B';

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
  const pythonStatus = usePythonRuntimeStore(st => st.status);
  const pythonProgress = usePythonRuntimeStore(st => st.downloadProgress);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  useEffect(() => {
    pythonRuntimeService.refreshStatus().catch(() => { });
  }, []);

  const enableTool = (toolId: string) => {
    const cur = useAppStore.getState().settings.enabledTools || [];
    if (!cur.includes(toolId)) updateSettings({ enabledTools: [...cur, toolId] });
  };

  const startPythonInstall = async () => {
    try {
      await pythonRuntimeService.install();
      enableTool('run_python');
    } catch (error) {
      setAlertState(showAlert(
        'Download Failed',
        error instanceof Error ? error.message : 'Could not download the Python runtime.',
      ));
    }
  };

  const promptPythonInstall = () => {
    setAlertState(showAlert(
      'Download Python Runtime',
      'Python needs a one-time 24 MB download (Python 3.12 with numpy and pandas). It runs entirely on your device and works offline afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => {
            setAlertState(hideAlert());
            startPythonInstall();
          },
        },
      ],
    ));
  };

  const handleToggleTool = (toolId: string) => {
    const cur = useAppStore.getState().settings.enabledTools || [];
    const enabling = !cur.includes(toolId);
    if (toolId === 'run_python' && enabling && usePythonRuntimeStore.getState().status !== 'installed') {
      promptPythonInstall();
      return;
    }
    // Disabling Python frees the warm interpreter: the Pyodide heap (CPython +
    // numpy + pandas, several hundred MB once imported) otherwise stays resident
    // for the app's lifetime and contends with local model inference.
    if (toolId === 'run_python' && !enabling) {
      pythonRuntimeService.shutdownExecutor().catch(() => { });
    }
    updateSettings({
      enabledTools: enabling ? [...cur, toolId] : cur.filter(id => id !== toolId),
    });
  };

  const showHint = enabledTools.length > 3 && !toolCountHintDismissed;

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
        <Text style={styles.headerTitle}>Tools</Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* Pro Tools always sits on top of the listing. */}
        <TouchableOpacity
          style={styles.proToolsButton}
          onPress={openProTools}
          activeOpacity={0.75}
          testID="tools-pro-tools"
        >
          <View style={styles.proToolsIcon}>
            <IconMC name="crown" size={20} color={colors.primary} />
          </View>
          <View style={styles.toolInfo}>
            <Text style={styles.toolName}>Pro Tools</Text>
            <Text style={styles.toolDescription}>Email, calendar and MCP servers</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {showHint && (
          <View style={[styles.hintBanner, { backgroundColor: colors.surface }]}>
            <Icon name="alert-circle" size={16} color={TOOL_WARNING_COLOR} style={styles.hintIcon} />
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

        {AVAILABLE_TOOLS.map(tool => {
          const isEnabled = enabledTools.includes(tool.id);
          const isPythonDownloading = tool.id === 'run_python' && pythonStatus === 'downloading';
          const description = isPythonDownloading
            ? `Downloading Python runtime... ${Math.round(pythonProgress * 100)}%`
            : tool.description;
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
                <Text style={styles.toolDescription}>{description}</Text>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={() => handleToggleTool(tool.id)}
                disabled={isPythonDownloading}
                trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                thumbColor={isEnabled ? colors.primary : colors.textMuted}
              />
            </View>
          );
        })}
        <Text style={styles.hint}>
          Enabling more tools can confuse the model and increases latency on first response.
        </Text>
      </ScrollView>
      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
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
  hint: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
  },
  hintBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    borderWidth: 1,
    borderColor: TOOL_WARNING_COLOR,
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
    color: TOOL_WARNING_COLOR,
  },
});
