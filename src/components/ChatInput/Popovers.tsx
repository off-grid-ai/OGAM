import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Modal, TouchableWithoutFeedback, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { ImageModeState } from '../../types';
import { useAppStore } from '../../stores';
import { triggerHaptic } from '../../utils/haptics';
import { FONTS } from '../../constants';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';

const TOOL_WARNING_COLOR = '#F59E0B';

// Popovers are anchored from the screen's right edge (`right: anchorX`) and
// extend leftward. When the trigger is far left (e.g. the audio-mode "+"), a
// large anchorX would push the popover off the left edge — clamp so its left
// edge stays ~8px inside the screen.
const POPOVER_WIDTH = 220;
const clampPopoverRight = (anchorX: number): number => {
  const screenW = Dimensions.get('window').width;
  return Math.max(8, Math.min(anchorX, screenW - POPOVER_WIDTH - 8));
};

// ─── Shared Styles ──────────────────────────────────────────────────────────

const SHADOW_COLOR = '#000';

export const popoverStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  popover: {
    position: 'absolute',
    minWidth: 180,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 6,
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.mono,
  },
  badge: {
    minWidth: 32,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '700',
  },
});

// ─── Quick Settings Popover ─────────────────────────────────────────────────

interface QuickSettingsPopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorY: number;
  anchorX: number;
  imageMode: ImageModeState;
  onImageModeToggle: () => void;
  imageModelLoaded: boolean;
  supportsThinking: boolean;
  supportsToolCalling: boolean;
  enabledToolCount: number;
  onToolsPress?: () => void;
  mcpToolCount?: number;
  onMcpPress?: () => void;
}

function getImageModeBadge(mode: ImageModeState, colors: any) {
  if (mode === 'force') return { label: 'ON', bg: colors.primary };
  if (mode === 'disabled') return { label: 'OFF', bg: colors.textMuted };
  return { label: 'Auto', bg: `${colors.textMuted}80` };
}

function getToolsStyle(supported: boolean, count: number, colors: any) {
  let iconColor = colors.textMuted;
  let badgeBg = colors.textMuted;
  let labelColor = colors.textMuted;
  let badgeLabel = 'N/A';

  if (supported) {
    const hasEnabledTools = count > 0;
    iconColor = hasEnabledTools ? colors.primary : colors.text;
    badgeBg = hasEnabledTools ? colors.primary : colors.textMuted;
    labelColor = colors.text;
    badgeLabel = String(count);
  }

  return { iconColor, badgeBg, labelColor, badgeLabel };
}

export const QuickSettingsPopover: React.FC<QuickSettingsPopoverProps> = ({
  visible, onClose, anchorY, anchorX,
  imageMode, onImageModeToggle, imageModelLoaded, supportsThinking,
  supportsToolCalling, enabledToolCount, onToolsPress,
  mcpToolCount = 0, onMcpPress,
}) => {
  const { colors } = useTheme();
  const { settings, updateSettings, toolCountHintDismissed } = useAppStore();

  if (!visible) return null;

  const imgBadge = getImageModeBadge(imageMode, colors);
  const tools = getToolsStyle(supportsToolCalling, enabledToolCount, colors);
  // The "Voice" row is provided by the pro audio feature via a slot. Free
  // builds render nothing here.
  const AudioRow = getSlot(SLOTS.quickSettingsAudioRow);

  // Tools and MCP warnings are independent — each turns amber at 3+
  const showToolsWarning = supportsToolCalling && enabledToolCount >= 3 && !toolCountHintDismissed;
  const showMcpWarning = mcpToolCount >= 3;

  const toolIconColor = showToolsWarning ? TOOL_WARNING_COLOR : tools.iconColor;
  const toolBadgeBg = showToolsWarning ? TOOL_WARNING_COLOR : tools.badgeBg;
  const mcpDefaultBg = mcpToolCount > 0 ? colors.primary : colors.textMuted;
  const mcpBadgeBg = showMcpWarning ? TOOL_WARNING_COLOR : mcpDefaultBg;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popoverStyles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[popoverStyles.popover, {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              bottom: anchorY + 8,
              right: clampPopoverRight(anchorX),
            }]}>
              <TouchableOpacity
                testID="quick-image-mode"
                style={popoverStyles.row}
                onPress={() => { triggerHaptic('impactLight'); onImageModeToggle(); }}
              >
                <Icon name="image" size={16} color={imageModelLoaded ? colors.text : colors.textMuted} />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>Image Gen</Text>
                <View testID={imageMode === 'force' ? 'image-mode-force-badge' : undefined} style={[popoverStyles.badge, { backgroundColor: imgBadge.bg }]}>
                  <Text style={[popoverStyles.badgeText, { color: colors.background }]}>{imgBadge.label}</Text>
                </View>
              </TouchableOpacity>

              {supportsThinking && (
                <TouchableOpacity
                  testID="quick-thinking-toggle"
                  style={popoverStyles.row}
                  onPress={() => {
                    triggerHaptic('impactLight');
                    updateSettings({ thinkingEnabled: !settings.thinkingEnabled });
                  }}
                >
                  <Icon name="zap" size={16} color={settings.thinkingEnabled ? colors.primary : colors.textMuted} />
                  <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>Thinking</Text>
                  <View style={[popoverStyles.badge, {
                    backgroundColor: settings.thinkingEnabled ? colors.primary : colors.textMuted,
                  }]}>
                    <Text style={[popoverStyles.badgeText, { color: colors.background }]}>
                      {settings.thinkingEnabled ? 'ON' : 'OFF'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {AudioRow && <AudioRow styles={popoverStyles} onClose={onClose} />}

              <TouchableOpacity
                testID="quick-tools"
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onClose();
                  if (supportsToolCalling) { onToolsPress?.(); }
                }}
              >
                <Icon name="tool" size={16} color={toolIconColor} />
                <Text style={[popoverStyles.rowLabel, { color: tools.labelColor }]}>Tools</Text>
                <View style={[popoverStyles.badge, { backgroundColor: toolBadgeBg }]}>
                  <Text style={[popoverStyles.badgeText, { color: colors.background }]}>{tools.badgeLabel}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-mcp"
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onClose();
                  onMcpPress?.();
                }}
              >
                <Icon name="cpu" size={16} color={mcpBadgeBg} />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>MCP</Text>
                <View style={[popoverStyles.badge, { backgroundColor: mcpBadgeBg }]}>
                  <Text style={[popoverStyles.badgeText, { color: colors.background }]}>{mcpToolCount}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ─── Attach Picker Popover ──────────────────────────────────────────────────

interface AttachPickerPopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorY: number;
  anchorX: number;
  supportsVision: boolean;
  onPhoto: () => void;
  onDocument: () => void;
}

export const AttachPickerPopover: React.FC<AttachPickerPopoverProps> = ({
  visible, onClose, anchorY, anchorX,
  supportsVision, onPhoto, onDocument,
}) => {
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popoverStyles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[popoverStyles.popover, {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              bottom: anchorY + 8,
              right: clampPopoverRight(anchorX),
            }]}>
              <TouchableOpacity
                testID="attach-photo"
                style={popoverStyles.row}
                onPress={() => { onClose(); onPhoto(); }}
              >
                <Icon name="camera" size={16} color={supportsVision ? colors.primary : colors.textMuted} />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="attach-document"
                style={popoverStyles.row}
                onPress={() => { onClose(); onDocument(); }}
              >
                <Icon name="file" size={16} color={colors.text} />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>Document</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
