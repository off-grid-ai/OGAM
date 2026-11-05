import { FastestSettingsButton } from '../settings/FastestSettingsButton';
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { llmService } from '../../services';
import { createStyles } from './styles';
import { VoiceTurnSettings } from '../settings/voiceSections';
import { GeneralGenerationControls } from '../settings/GeneralGenerationControls';
import { ConversationActionsSection } from './ConversationActionsSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { TranscriptionLanguageSelect } from '../TranscriptionLanguageSelect';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { SettingsSectionHeader } from '../settings/SettingsSectionHeader';
import { useSectionSummaries } from '../settings/sectionSummaries';

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
  const summaries = useSectionSummaries();
  const styles = useThemedStyles(createStyles);
  const resetSettings = useAppStore((state) => state.resetSettings);

  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [generalSettingsOpen, setGeneralSettingsOpen] = useState(false);
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [sttSettingsOpen, setSttSettingsOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  // TTS settings come from the pro audio feature via a slot. Free builds have
  // no TTS section.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);
  const VideoSettings = getSlot(SLOTS.generationSettingsVideo);

  useEffect(() => {
    if (visible) {
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible]);


  return (
    <AppSheet
      sheet="generation-settings"
      visible={visible}
      onClose={onClose}
      snapPoints={['50%', '90%']}
      title="Chat settings"
    >
      {performanceStats.lastTokensPerSecond > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsLabel}>Last reply</Text>
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

        {/* It places every modality (text, image, video, speech, voice, search), so it leads the settings. */}
        <FastestSettingsButton />
        <SettingsSectionHeader
          title="General"
          open={generalSettingsOpen}
          onToggle={() => setGeneralSettingsOpen(!generalSettingsOpen)}
          testID="modal-general-accordion"
        />
        {generalSettingsOpen && <View style={styles.sectionCard}><GeneralGenerationControls /></View>}

        <SettingsSectionHeader
          title="Image generation"
          summary={summaries.image}
          open={imageSettingsOpen}
          onToggle={() => setImageSettingsOpen(!imageSettingsOpen)}
          testID="modal-image-accordion"
        />
        {imageSettingsOpen && <ImageGenerationSection />}
        {VideoSettings && <VideoSettings />}

        <SettingsSectionHeader
          title="Text generation"
          summary={summaries.text}
          open={textSettingsOpen}
          onToggle={() => setTextSettingsOpen(!textSettingsOpen)}
        />
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

        <SettingsSectionHeader
          title="Speech to text"
          open={sttSettingsOpen}
          onToggle={() => setSttSettingsOpen(!sttSettingsOpen)}
          testID="modal-transcription-accordion"
        />
        {sttSettingsOpen && (
          <View style={styles.sectionCard}>
            <TranscriptionLanguageSelect testID="chat-transcription-language" />
            {/* Voice mode ends a turn on silence. Lives with STT because it is about listening. */}
            <VoiceTurnSettings />
          </View>
        )}

        {/* TTS SETTINGS (pro audio feature) */}
        {TtsSection && (
          <>
            <SettingsSectionHeader
              title="Text to speech"
              open={ttsSettingsOpen}
              onToggle={() => setTtsSettingsOpen(!ttsSettingsOpen)}
            />
            {ttsSettingsOpen && (
              <TtsSection onNavigateToTTSSettings={onOpenTTSSettings} />
            )}
          </>
        )}

        <TouchableOpacity style={styles.resetButton} onPress={resetSettings} accessibilityRole="button">
          <Text style={styles.resetButtonText}>Reset to defaults</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </AppSheet>
  );
};
