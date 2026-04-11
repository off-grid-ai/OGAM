import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Modal, TouchableWithoutFeedback, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme';
import { ImageModeState } from '../../types';
import { useAppStore, useTTSStore } from '../../stores';
import { triggerHaptic } from '../../utils/haptics';
import { FONTS, TYPOGRAPHY } from '../../constants';
import { KOKORO_VOICES } from '../../constants/kokoroModels';
import type { KokoroVoiceId } from '../../constants/kokoroModels';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

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
}) => {
  const { colors } = useTheme();
  const { settings, updateSettings } = useAppStore();
  const { settings: ttsSettings, isBackboneDownloaded, isVocoderDownloaded, isModelLoaded, loadModels, unloadModels, updateSettings: updateTTSSettings } = useTTSStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  if (!visible) return null;

  const imgBadge = getImageModeBadge(imageMode, colors);
  const tools = getToolsStyle(supportsToolCalling, enabledToolCount, colors);
  const ttsAvailable = isBackboneDownloaded && isVocoderDownloaded;
  const ttsMode = ttsSettings.interfaceMode;
  const ttsBadge = !ttsAvailable
    ? { label: 'N/A', bg: colors.textMuted }
    : ttsMode === 'audio'
      ? { label: 'Audio', bg: colors.primary }
      : { label: 'Chat', bg: `${colors.textMuted}80` };

  const handleTTSToggle = () => {
    triggerHaptic('impactLight');
    if (!ttsAvailable) { onClose(); navigation.navigate('TTSSettings'); return; }
    onClose();
    const next = ttsMode === 'audio' ? 'chat' : 'audio';
    updateTTSSettings({ interfaceMode: next });
    if (next === 'audio' && !isModelLoaded) { loadModels(); }
    if (next === 'chat' && isModelLoaded) { unloadModels(); }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popoverStyles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[popoverStyles.popover, {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              bottom: anchorY + 8,
              right: anchorX,
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

              <TouchableOpacity
                testID="quick-tts-mode"
                style={popoverStyles.row}
                onPress={handleTTSToggle}
              >
                <Icon name={ttsMode === 'audio' ? 'volume-2' : 'volume-1'} size={16} color={ttsAvailable ? colors.text : colors.textMuted} />
                <Text style={[popoverStyles.rowLabel, { color: ttsAvailable ? colors.text : colors.textMuted }]}>Voice</Text>
                <View style={[popoverStyles.badge, { backgroundColor: ttsBadge.bg }]}>
                  <Text style={[popoverStyles.badgeText, { color: colors.background }]}>{ttsBadge.label}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                testID="quick-tools"
                style={popoverStyles.row}
                onPress={() => {
                  triggerHaptic('impactLight');
                  onClose();
                  if (supportsToolCalling) { onToolsPress?.(); }
                }}
              >
                <Icon name="tool" size={16} color={tools.iconColor} />
                <Text style={[popoverStyles.rowLabel, { color: tools.labelColor }]}>Tools</Text>
                <View style={[popoverStyles.badge, { backgroundColor: tools.badgeBg }]}>
                  <Text style={[popoverStyles.badgeText, { color: colors.background }]}>{tools.badgeLabel}</Text>
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
              right: anchorX,
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

// ─── Voice Picker Popover ──────────────────────────────────────────────────

interface VoicePickerPopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorY: number;
  anchorX: number;
}

export const VoicePickerPopover: React.FC<VoicePickerPopoverProps> = ({
  visible, onClose, anchorY, anchorX,
}) => {
  const { colors } = useTheme();
  const kokoroVoiceId = useTTSStore((s) => s.settings.kokoroVoiceId);
  const isChangingVoice = useTTSStore((s) => s.settings.kokoroVoiceId !== s.kokoroActiveVoiceId);
  const { isSpeaking, stop, updateSettings } = useTTSStore();

  if (!visible) return null;

  const handleSelect = (voice: typeof KOKORO_VOICES[number]) => {
    triggerHaptic('impactLight');
    // Stop playback first — KokoroTTSManager defers voice config changes
    // until isSpeaking is false, so no native crash
    if (isSpeaking) { stop(); }
    updateSettings({ kokoroVoiceId: voice.id as KokoroVoiceId, speed: voice.defaultSpeed });
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popoverStyles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[popoverStyles.popover, voicePickerStyles.popover, {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              bottom: anchorY + 8,
              right: anchorX,
            }]}>
              {KOKORO_VOICES.map((voice) => {
                const isActive = voice.id === kokoroVoiceId;
                return (
                  <TouchableOpacity
                    key={voice.id}
                    style={popoverStyles.row}
                    onPress={() => handleSelect(voice)}
                  >
                    <Icon
                      name="user"
                      size={14}
                      color={isActive ? colors.primary : colors.textMuted}
                    />
                    <View style={voicePickerStyles.labelCol}>
                      <Text style={[popoverStyles.rowLabel, { color: isActive ? colors.primary : colors.text }]}>
                        {voice.label}
                      </Text>
                      <Text style={[voicePickerStyles.accent, { color: colors.textMuted }]}>
                        {voice.persona}
                      </Text>
                    </View>
                    {isActive && (
                      isChangingVoice
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <Icon name="check" size={14} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const voicePickerStyles = StyleSheet.create({
  popover: {
    minWidth: 200,
  },
  labelCol: {
    flex: 1,
  },
  accent: {
    ...TYPOGRAPHY.meta,
    marginTop: 1,
  },
});
