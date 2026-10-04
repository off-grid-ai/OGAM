import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { modelsFailureMessage } from '@offgrid/application';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { DEFAULT_SETTINGS } from '../../stores/appStore';
import { applicationFacade } from '../../services/applicationFacade';
import { llmService } from '../../services';
import { createStyles } from './styles';
import { VoiceTurnSettings } from '../settings/voiceSections';
import { ConversationActionsSection } from './ConversationActionsSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { WhisperPickerSheet } from '../models/WhisperPickerSheet';
import { TranscriptionLanguageSelect } from '../TranscriptionLanguageSelect';
import {
  NO_TRANSCRIPTION_MODEL_LABEL,
  useTranscriptionModelSetting,
} from '../../hooks/useTranscriptionModelSetting';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';

interface GenerationSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenProject?: () => void;
  onOpenGallery?: () => void;
  onDeleteConversation?: () => void;
  onOpenTTSSettings?: () => void;
  conversationImageCount?: number;
  activeProjectName?: string | null;
  isRemote?: boolean;
}

export const GenerationSettingsModal: React.FC<
  GenerationSettingsModalProps
> = ({
  visible,
  onClose,
  onOpenProject,
  onOpenGallery,
  onDeleteConversation,
  onOpenTTSSettings,
  conversationImageCount = 0,
  activeProjectName,
  isRemote,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [resetPending, setResetPending] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const { modelName: sttModelName } = useTranscriptionModelSetting();

  const [performanceStats, setPerformanceStats] = useState(
    llmService.getPerformanceStats(),
  );
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [sttSettingsOpen, setSttSettingsOpen] = useState(false);
  const [whisperPickerOpen, setWhisperPickerOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  // TTS settings come from the pro audio feature via a slot. Free builds have
  // no TTS section.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);

  useEffect(() => {
    if (visible) {
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible]);

  const hasConversationActions = !!(
    onOpenProject ||
    onOpenGallery ||
    onDeleteConversation
  );

  const resetSettings = async (): Promise<void> => {
    if (resetPending) return;
    setResetPending(true);
    setResetMessage(null);
    const outcome = await applicationFacade().models.settings.restoreDefaults(
      DEFAULT_SETTINGS,
    );
    setResetPending(false);
    const failure = outcome.ok ? outcome.value.syncFailure : outcome.failure;
    setResetMessage(failure ? modelsFailureMessage(failure) : null);
  };

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['50%', '90%']}
      title="Chat Settings"
    >
      {performanceStats.lastTokensPerSecond > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsLabel}>Last Generation:</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokensPerSecond.toFixed(1)} tok/s
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokenCount} tokens
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastGenerationTime.toFixed(1)}s
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <ConversationActionsSection
          onClose={onClose}
          onOpenProject={onOpenProject}
          onOpenGallery={onOpenGallery}
          onDeleteConversation={onDeleteConversation}
          conversationImageCount={conversationImageCount}
          activeProjectName={activeProjectName}
        />

        {/* IMAGE GENERATION SETTINGS */}
        <TouchableOpacity
          style={[
            styles.accordionHeader,
            !hasConversationActions && styles.accordionHeaderNoMargin,
          ]}
          onPress={() => setImageSettingsOpen(!imageSettingsOpen)}
          activeOpacity={0.7}
          testID="modal-image-accordion"
        >
          <Text style={styles.accordionTitle}>IMAGE GENERATION</Text>
          <Icon
            name={imageSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {imageSettingsOpen && <ImageGenerationSection />}

        {/* TEXT GENERATION SETTINGS */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => setTextSettingsOpen(!textSettingsOpen)}
          activeOpacity={0.7}
        >
          <Text style={styles.accordionTitle}>TEXT GENERATION</Text>
          <Icon
            name={textSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {textSettingsOpen && (
          <>
            {isRemote && (
              <View style={styles.remoteNotice}>
                <Icon name="info" size={13} color={colors.textMuted} />
                <Text style={styles.remoteNoticeText}>
                  These settings only apply to local models and won't affect the
                  current remote session.
                </Text>
              </View>
            )}
            <TextGenerationSection />
          </>
        )}

        {/* SPEECH TO TEXT SETTINGS */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => setSttSettingsOpen(!sttSettingsOpen)}
          activeOpacity={0.7}
          testID="modal-transcription-accordion"
        >
          <Text style={styles.accordionTitle}>SPEECH TO TEXT</Text>
          <Icon
            name={sttSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {sttSettingsOpen && (
          <View style={styles.sectionCard}>
            <TouchableOpacity
              style={styles.modelPickerButton}
              onPress={() => setWhisperPickerOpen(true)}
              activeOpacity={0.7}
              testID="modal-stt-open-picker"
            >
              <View style={styles.modelPickerContent}>
                <Text style={styles.modelPickerLabel}>Transcription model</Text>
                <Text style={styles.modelPickerValue}>
                  {sttModelName ?? NO_TRANSCRIPTION_MODEL_LABEL}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TranscriptionLanguageSelect testID="chat-transcription-language" />
            {/* Voice mode ends a turn on silence. Lives with STT because it is about listening. */}
            <VoiceTurnSettings />
          </View>
        )}

        {/* TTS SETTINGS (pro audio feature) */}
        {TtsSection && (
          <>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setTtsSettingsOpen(!ttsSettingsOpen)}
              activeOpacity={0.7}
            >
              <Text style={styles.accordionTitle}>TEXT TO SPEECH</Text>
              <Icon
                name={ttsSettingsOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {ttsSettingsOpen && (
              <TtsSection onNavigateToTTSSettings={onOpenTTSSettings} />
            )}
          </>
        )}

        {resetMessage ? (
          <Text style={styles.actionTextError}>{resetMessage}</Text>
        ) : null}
        <TouchableOpacity
          style={styles.resetButton}
          onPress={resetSettings}
          disabled={resetPending}
        >
          <Text style={styles.resetButtonText}>
            {resetPending ? 'Resetting…' : 'Reset to Defaults'}
          </Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
      {whisperPickerOpen ? (
        <WhisperPickerSheet
          visible
          onClose={() => setWhisperPickerOpen(false)}
        />
      ) : null}
    </AppSheet>
  );
};
