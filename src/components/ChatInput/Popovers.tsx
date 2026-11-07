import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableWithoutFeedback, Dimensions } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { ImageModeState } from '../../types';
import { useAppStore } from '../../stores';
import { triggerHaptic } from '../../utils/haptics';
import { TYPOGRAPHY } from '../../constants';
import Animated, { Easing, withTiming } from 'react-native-reanimated';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { QuickBadge, type QuickBadgeTone } from './QuickBadge';

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

export const popoverStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  popover: {
    position: 'absolute',
    // The width the edge clamp assumes; content-sized, a row's flex label shrinks and wraps under its badge.
    width: POPOVER_WIDTH,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    overflow: 'hidden',
    // Grows out of the settings control it opens from (bottom right), not a fade in mid-air.
    transformOrigin: 'bottom right',
  },
  // Every row the same 44 pt, so the menu reads as one column of controls.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    gap: 12,
  },
  // Modes above, the tool screens below.
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  // A menu item is words: Geist, sentence case (hand test 60: Title Case in Mono).
  rowLabel: {
    flex: 1,
    ...TYPOGRAPHY.body,
  },
});

// Grows from the control it opens from: a short scale and fade (~200 ms), never a full-screen fade.
const growIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ scale: withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};

// ─── Quick Settings Popover ─────────────────────────────────────────────────

interface QuickSettingsPopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorY: number;
  anchorX: number;
  imageMode: ImageModeState;
  onImageModeToggle: () => void;
  onVideoModeToggle?: () => void;
  imageModelLoaded: boolean;
  supportsThinking: boolean;
  supportsToolCalling: boolean;
  enabledToolCount: number;
  onToolsPress?: () => void;
  mcpToolCount?: number;
  onMcpPress?: () => void;
}

function getImageModeBadge(mode: ImageModeState): { label: string; tone: QuickBadgeTone } {
  if (mode === 'force') return { label: 'ON', tone: 'on' };
  if (mode === 'disabled' || mode === 'video')
    return { label: 'OFF', tone: 'off' };
  return { label: 'Auto', tone: 'off' };
}

function getToolsStyle(supported: boolean, count: number, colors: any) {
  let iconColor = colors.textMuted;
  let labelColor = colors.textMuted;
  let badgeLabel = 'N/A';

  if (supported) {
    // The icon and badge stay neutral - this row is a utility count, not an
    // on/off state, so it should not read as "active/highlighted" in green.
    iconColor = colors.text;
    labelColor = colors.text;
    badgeLabel = String(count);
  }

  return { iconColor, labelColor, badgeLabel };
}

export const QuickSettingsPopover: React.FC<QuickSettingsPopoverProps> = ({
  visible,
  onClose,
  anchorY,
  anchorX,
  imageMode,
  onImageModeToggle,
  onVideoModeToggle,
  imageModelLoaded,
  supportsThinking,
  supportsToolCalling,
  enabledToolCount,
  onToolsPress,
  mcpToolCount = 0,
  onMcpPress,
}) => {
  const { colors, shadows } = useTheme();
  const thinkingEnabled = useAppStore(state => state.settings.thinkingEnabled);
  const updateSettings = useAppStore(state => state.updateSettings);
  const toolCountHintDismissed = useAppStore(state => state.toolCountHintDismissed);

  if (!visible) return null;

  const imgBadge = getImageModeBadge(imageMode);
  const tools = getToolsStyle(supportsToolCalling, enabledToolCount, colors);
  // The "Voice" row is provided by the pro audio feature via a slot. Free
  // builds render nothing here.
  const AudioRow = getSlot(SLOTS.quickSettingsAudioRow);

  // Tools and MCP warnings are independent — each turns amber at 3+
  const showToolsWarning = supportsToolCalling && enabledToolCount >= 3 && !toolCountHintDismissed;

  const toolIconColor = showToolsWarning ? TOOL_WARNING_COLOR : colors.textSecondary;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      {/* accessible={false} on the SCRIM too. The inner wrapper was fixed first, but this outer
          dismiss layer wraps the whole popover and merges it just the same - iOS reported one
          control named ", Image Gen, Auto, , Thinking, ON, , Voice, Chat, , Tools, 1, Pro Tools, 6"
          with every row's testID gone. Both layers exist only to route taps, so neither should be
          an accessibility element. */}
      <TouchableWithoutFeedback accessible={false} onPress={onClose}>
        <View style={popoverStyles.overlay}>
          {/* accessible={false}: this wrapper exists only to stop a tap inside the popover reaching
              the dismiss scrim behind it. Left as an accessibility element it MERGES every row into
              itself, so the whole popover reports as one control named
              ", Image Gen, Auto, , Thinking, ON, ..." - each row's testID disappears, VoiceOver
              reads a single blob instead of five controls, and neither a person nor a test can
              reach one setting. Android exposes the rows individually; this is what made iOS
              differ. */}
          <TouchableWithoutFeedback accessible={false}>
            <Animated.View
              entering={growIn}
              style={[
                popoverStyles.popover,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderLight,
                  ...shadows.medium,
                  bottom: anchorY + 8,
                  right: clampPopoverRight(anchorX),
                },
              ]}
            >
              <TouchableOpacity
                testID="quick-image-mode"
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onImageModeToggle();
                }}
              >
                <Icon
                  name="image"
                  size={16}
                  color={imageModelLoaded || imageMode === 'force' ? colors.textSecondary : colors.textMuted}
                />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>
                  Image
                </Text>
                <QuickBadge
                  testID={imageMode === 'force' ? 'image-mode-force-badge' : undefined}
                  tone={imgBadge.tone}
                  label={imgBadge.label}
                />
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-video-mode"
                disabled={!onVideoModeToggle}
                accessibilityRole="button"
                accessibilityState={{
                  selected: imageMode === 'video',
                  disabled: !onVideoModeToggle,
                }}
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onVideoModeToggle?.();
                }}
              >
                <Icon
                  name="video"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>
                  Video
                </Text>
                <QuickBadge tone={imageMode === 'video' ? 'on' : 'off'} label={imageMode === 'video' ? 'ON' : 'OFF'} />
              </TouchableOpacity>

              {supportsThinking && (
                <TouchableOpacity
                  testID="quick-thinking-toggle"
                  style={popoverStyles.row}
                  onPress={() => {
                    triggerHaptic('impactLight');
                    updateSettings({ thinkingEnabled: !thinkingEnabled });
                  }}
                >
                  <Icon
                    name="zap"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[popoverStyles.rowLabel, { color: colors.text }]}
                  >
                    Thinking
                  </Text>
                  <QuickBadge tone={thinkingEnabled ? 'on' : 'off'} label={thinkingEnabled ? 'ON' : 'OFF'} />
                </TouchableOpacity>
              )}

              {AudioRow && <AudioRow styles={popoverStyles} onClose={onClose} />}

              <View style={[popoverStyles.divider, { backgroundColor: colors.borderLight }]} />

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
                <Text
                  style={[popoverStyles.rowLabel, { color: tools.labelColor }]}
                >
                  Tools
                </Text>
                <QuickBadge tone={showToolsWarning ? 'warn' : 'count'} label={tools.badgeLabel} />
                <Icon name="chevron-right" size={14} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-pro-tools"
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onClose();
                  onMcpPress?.();
                }}
              >
                <Icon name="package" size={16} color={colors.textSecondary} />
                <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>
                  Pro tools
                </Text>
                {mcpToolCount > 0 && (
                  <QuickBadge tone="count" label={mcpToolCount} />
                )}
                <Icon name="chevron-right" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// ─── Attach Picker Popover ──────────────────────────────────────────────────

/** One thing the + can add. The same list feeds the iOS action sheet and this popover. */
export interface AttachChoice {
  key: 'camera' | 'library' | 'photo' | 'document';
  label: string;
  icon: string;
  onPress: () => void;
}

interface AttachPickerPopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorY: number;
  anchorX: number;
  choices: AttachChoice[];
}

export const AttachPickerPopover: React.FC<AttachPickerPopoverProps> = ({
  visible,
  onClose,
  anchorY,
  anchorX,
  choices,
}) => {
  const { colors, shadows } = useTheme();

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* accessible={false} on the SCRIM too. The inner wrapper was fixed first, but this outer
          dismiss layer wraps the whole popover and merges it just the same - iOS reported one
          control named ", Image Gen, Auto, , Thinking, ON, , Voice, Chat, , Tools, 1, Pro Tools, 6"
          with every row's testID gone. Both layers exist only to route taps, so neither should be
          an accessibility element. */}
      <TouchableWithoutFeedback accessible={false} onPress={onClose}>
        <View style={popoverStyles.overlay}>
          {/* accessible={false}: this wrapper exists only to stop a tap inside the popover reaching
              the dismiss scrim behind it. Left as an accessibility element it MERGES every row into
              itself, so the whole popover reports as one control named
              ", Image Gen, Auto, , Thinking, ON, ..." - each row's testID disappears, VoiceOver
              reads a single blob instead of five controls, and neither a person nor a test can
              reach one setting. Android exposes the rows individually; this is what made iOS
              differ. */}
          <TouchableWithoutFeedback accessible={false}>
            <View
              style={[
                popoverStyles.popover,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  ...shadows.medium,
                  bottom: anchorY + 8,
                  right: clampPopoverRight(anchorX),
                },
              ]}
            >
              {choices.map(choice => (
                <TouchableOpacity
                  key={choice.key}
                  testID={`attach-${choice.key}`}
                  style={popoverStyles.row}
                  onPress={() => {
                    onClose();
                    choice.onPress();
                  }}
                >
                  <Icon name={choice.icon} size={16} color={colors.text} />
                  <Text style={[popoverStyles.rowLabel, { color: colors.text }]}>{choice.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
