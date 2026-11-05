import { FastestSettingsButton } from '../../components/settings/FastestSettingsButton';
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';
import { SystemPromptSection } from '../../components/settings/SystemPromptSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { VoiceTurnSettings } from '../../components/settings/voiceSections';
import { GeneralGenerationControls } from '../../components/settings/GeneralGenerationControls';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import {
  NO_TRANSCRIPTION_MODEL_LABEL,
  useTranscriptionModelSetting,
} from '../../hooks/useTranscriptionModelSetting';
import { SettingsSectionHeader } from '../../components/settings/SettingsSectionHeader';
import { useSectionSummaries } from './sectionSummaries';
import { AliveScreen } from '../../components/AliveScreen';
import { ScreenHeader } from '../../components/ScreenHeader';

export const ModelSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const resetSettings = useAppStore(s => s.resetSettings);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const [promptOpen, setPromptOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [sttOpen, setSttOpen] = useState(false);
  const [whisperOpen, setWhisperOpen] = useState(false);
  // TTS is a pro feature injected via a slot (same as the in-chat generation settings). Free builds have no
  // slot → the section is not shown at all.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);
  const VideoSettings = getSlot(SLOTS.generationSettingsVideo);
  const { modelName: sttModelName, isRemote: isRemoteTranscription } =
    useTranscriptionModelSetting();
  const summaries = useSectionSummaries();

  const handleReset = () => {
    setAlertState(
      showAlert(
        'Reset all settings',
        'This will restore all model settings to their defaults. You may need to reload the model for changes to take effect.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: () => {
              resetSettings();
              setAlertState(hideAlert());
            },
          },
        ],
      ),
    );
  };

  return (
    <AliveScreen style={styles.container}>
      <ScreenHeader
        title="Model settings"
        onBack={() => navigation.goBack()}
        right={
          // In the header, away from the foot of the page where a tab bar sits on other screens.
          <Button
            title="Reset"
            variant="ghost"
            size="small"
            onPress={handleReset}
            testID="reset-settings-button"
            accessibilityLabel="Reset to defaults"
          />
        }
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {/* It places every modality (text, image, video, speech, voice, search), so it leads the screen. */}
        <FastestSettingsButton />
        <SettingsSectionHeader
          title="General"
          open={generalOpen}
          onToggle={() => setGeneralOpen(!generalOpen)}
          testID="general-generation-accordion"
        />
        {generalOpen && <View style={styles.settingSection}><GeneralGenerationControls /></View>}
          <SettingsSectionHeader
            title="Default system prompt"
            summary={summaries.prompt}
            open={promptOpen}
            onToggle={() => setPromptOpen(!promptOpen)}
            testID="system-prompt-accordion"
          />
        {promptOpen && <SystemPromptSection />}

        <SettingsSectionHeader
          title="Image generation"
          summary={summaries.image}
          open={imageOpen}
          onToggle={() => setImageOpen(!imageOpen)}
          testID="image-generation-accordion"
        />
        {imageOpen && <ImageGenerationSection />}
        {VideoSettings && <VideoSettings />}

        <SettingsSectionHeader
          title="Text generation"
          summary={summaries.text}
          open={textOpen}
          onToggle={() => setTextOpen(!textOpen)}
          testID="text-generation-accordion"
        />
        {textOpen && <TextGenerationSection />}

        {/* Transcription (STT/whisper) — core. Reuses the same picker sheet Home/Chat open, and the same
            whisper store as its single source, so the active model shown here is always consistent. */}
        <SettingsSectionHeader
          title="Transcription"
          summary={sttModelName ?? NO_TRANSCRIPTION_MODEL_LABEL}
          open={sttOpen}
          onToggle={() => setSttOpen(!sttOpen)}
          testID="transcription-accordion"
        />
        {sttOpen && (
          <View style={styles.settingSection}>
            <Text style={styles.settingDesc}>
              {isRemoteTranscription
                ? 'Your active remote server transcribes dictation and voice chat.'
                : 'The on-device model used to transcribe your voice for dictation and voice chat.'}
            </Text>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setWhisperOpen(true)}
              activeOpacity={0.7}
              testID="stt-open-picker"
            >
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Transcription model</Text>
                <Text style={styles.toggleDesc}>
                  {sttModelName ?? NO_TRANSCRIPTION_MODEL_LABEL}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            {/* Voice mode ends a turn on silence. Lives with STT because it is about listening. */}
            <VoiceTurnSettings />
          </View>
        )}

        {/* Text to Speech — pro feature via slot; free builds render nothing (no accordion). */}
        {TtsSection && (
          <>
            <SettingsSectionHeader
              title="Text to speech"
              open={ttsOpen}
              onToggle={() => setTtsOpen(!ttsOpen)}
              testID="tts-accordion"
            />
            {ttsOpen && <TtsSection />}
          </>
        )}

      </ScrollView>
      {whisperOpen ? (
        <WhisperPickerSheet visible onClose={() => setWhisperOpen(false)} />
      ) : null}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </AliveScreen>
  );
};
