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
import { UnderlineTabs, type UnderlineTab } from '../../components/UnderlineTabs';
import { TranscriptionLanguageSelect } from '../../components/TranscriptionLanguageSelect';
import { useRemoteServerStore } from '../../stores';
import { AliveScreen } from '../../components/AliveScreen';
import { SectionLabel } from '../../components/SectionLabel';
import { ScreenHeader } from '../../components/ScreenHeader';

type SettingsTab = 'general' | 'text' | 'image' | 'voice';

/**
 * Every model setting, in one place (the chat's settings sheet links here rather than copying them).
 * Tabs, not a stack of accordions (screen review): each tab shows its settings open.
 */
export const ModelSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const resetSettings = useAppStore(s => s.resetSettings);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [whisperOpen, setWhisperOpen] = useState(false);
  const textIsRemote = useRemoteServerStore(s => s.activeServerId != null);
  // TTS is a pro feature injected via a slot (same as the in-chat generation settings). Free builds have no
  // slot → the section is not shown at all.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);
  const VideoSettings = getSlot(SLOTS.generationSettingsVideo);
  const { modelName: sttModelName, isRemote: isRemoteTranscription } =
    useTranscriptionModelSetting();
  const tabs: UnderlineTab<SettingsTab>[] = [
    { key: 'general', label: 'General', testID: 'model-settings-tab-general' },
    { key: 'text', label: 'Text', testID: 'model-settings-tab-text' },
    { key: 'image', label: VideoSettings ? 'Image & video' : 'Image', testID: 'model-settings-tab-image' },
    { key: 'voice', label: 'Voice', testID: 'model-settings-tab-voice' },
  ];

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
      <UnderlineTabs tabs={tabs} active={tab} onChange={setTab} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {tab === 'general' && (
          <>
            {/* It places every modality (text, image, video, speech, voice, search), so it leads. */}
            <FastestSettingsButton />
            <View style={styles.sectionsGroup}>
              <View style={styles.settingSection}><GeneralGenerationControls /></View>
              <SystemPromptSection />
            </View>
          </>
        )}

        {tab === 'text' && (
          <>
            {/* The section draws its own card: wrapping it made a card inside a card (hand test 71). */}
            <TextGenerationSection />
            {textIsRemote ? (
              <Text style={styles.footnote} testID="model-settings-remote-note">
                These apply to models on this phone. A remote server uses its own.
              </Text>
            ) : null}
          </>
        )}

        {tab === 'image' && (
          <>
            {/* Labelled like the Video card under it, so the tab reads as two named groups. */}
            {VideoSettings ? <SectionLabel title="Image" /> : null}
            <ImageGenerationSection />
            {VideoSettings && <VideoSettings alwaysOpen />}
          </>
        )}

        {tab === 'voice' && (
          <>
            {/* Transcription: the same picker sheet Home and Chat open, on the same whisper store. */}
            <View style={styles.sectionsGroup}>
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
                <TranscriptionLanguageSelect testID="settings-transcription-language" />
                {/* Voice mode ends a turn on silence. Lives with listening. */}
                <VoiceTurnSettings />
              </View>
            </View>
            {/* Text to speech is Pro, through a slot; free builds show none. */}
            {TtsSection && (
              <View style={styles.sectionGap}>
                <TtsSection />
              </View>
            )}
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
