import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { consumePendingSpotlight } from '../../components/onboarding/spotlightState';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';
import { useLayoutClass } from '../../hooks/useLayoutClass';
import { useWideLayout } from '../../hooks/useWideLayout';
import { SystemPromptSection } from './SystemPromptSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import { useWhisperStore } from '../../stores/whisperStore';
import { WHISPER_MODELS } from '../../services/whisperService';

export const ModelSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { goTo } = useSpotlightTour();
  const resetSettings = useAppStore((s) => s.resetSettings);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { twoPane } = useLayoutClass();
  const wide = useWideLayout();
  // On a large tablet there is room to show the main sections open from the start.
  const [promptOpen, setPromptOpen] = useState(twoPane);
  const [imageOpen, setImageOpen] = useState(twoPane);
  const [textOpen, setTextOpen] = useState(twoPane);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [sttOpen, setSttOpen] = useState(false);
  const [whisperOpen, setWhisperOpen] = useState(false);
  // TTS is a feature injected via a slot (same as the in-chat generation settings). With no
  // slot the section is not shown at all.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);
  // Active transcription (STT/whisper) model — the single source is the whisper store (same as the picker).
  const sttModelId = useWhisperStore((s) => s.downloadedModelId);
  const sttModelName = WHISPER_MODELS.find((m) => m.id === sttModelId)?.name ?? null;

  // If user arrived here via onboarding spotlight flow, show accordion spotlight
  useEffect(() => {
    const pending = consumePendingSpotlight();
    if (pending !== null) {
      const task = InteractionManager.runAfterInteractions(() => goTo(pending));
      return () => task.cancel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => {
    setAlertState(showAlert(
      'Reset All Settings',
      'This will restore all model settings to their defaults. You may need to reload the model for changes to take effect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => { resetSettings(); setAlertState(hideAlert()); },
        },
      ],
    ));
  };

  const promptBlock = (
    <>
          <AttachStep index={6} fill>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setPromptOpen(!promptOpen)}
              activeOpacity={0.7}
              testID="system-prompt-accordion"
            >
              <Text style={styles.accordionTitle}>Default System Prompt</Text>
              <Icon
                name={promptOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          </AttachStep>
          {promptOpen && <SystemPromptSection />}
    </>
  );
  const imageBlock = (
    <>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setImageOpen(!imageOpen)}
            activeOpacity={0.7}
            testID="image-generation-accordion"
          >
            <Text style={styles.accordionTitle}>Image Generation</Text>
            <Icon
              name={imageOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>
          {imageOpen && <ImageGenerationSection />}
    </>
  );
  const textBlock = (
    <>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setTextOpen(!textOpen)}
            activeOpacity={0.7}
            testID="text-generation-accordion"
          >
            <Text style={styles.accordionTitle}>Text Generation</Text>
            <Icon
              name={textOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </TouchableOpacity>
          {textOpen && <TextGenerationSection />}
    </>
  );
  const sttBlock = (
    <>
          {/* Transcription (STT/whisper) — core. Reuses the same picker sheet Home/Chat open, and the same
              whisper store as its single source, so the active model shown here is always consistent. */}
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setSttOpen(!sttOpen)}
            activeOpacity={0.7}
            testID="transcription-accordion"
          >
            <Text style={styles.accordionTitle}>Transcription (Speech to Text)</Text>
            <Icon name={sttOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
          {sttOpen && (
            <View style={styles.settingSection}>
              <Text style={styles.settingDesc}>
                The on-device model used to transcribe your voice for dictation and voice chat.
              </Text>
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setWhisperOpen(true)}
                activeOpacity={0.7}
                testID="stt-open-picker"
              >
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>Transcription model</Text>
                  <Text style={styles.toggleDesc}>{sttModelName ?? 'None selected — tap to choose'}</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
    </>
  );
  const ttsBlock = (
    <>
          {/* Text to Speech — feature via slot; nothing renders when it is absent (no accordion). */}
          {TtsSection && (
            <>
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => setTtsOpen(!ttsOpen)}
                activeOpacity={0.7}
                testID="tts-accordion"
              >
                <Text style={styles.accordionTitle}>Text to Speech</Text>
                <Icon name={ttsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
              {ttsOpen && <TtsSection />}
            </>
          )}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Model Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.content, wide.column, twoPane && styles.contentWide]}>
        {twoPane ? (
          // Large tablet: two open columns instead of one long list of collapsed sections.
          <View style={styles.columns} testID="model-settings-two-column">
            <View style={styles.column}>{promptBlock}{textBlock}</View>
            <View style={styles.column}>{imageBlock}{sttBlock}{ttsBlock}</View>
          </View>
        ) : (
          <>{promptBlock}{imageBlock}{textBlock}{sttBlock}{ttsBlock}</>
        )}

        <Button
          title="Reset All to Defaults"
          variant="ghost"
          size="small"
          onPress={handleReset}
          testID="reset-settings-button"
          style={styles.resetButton}
        />
      </ScrollView>
      <WhisperPickerSheet visible={whisperOpen} onClose={() => setWhisperOpen(false)} />
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};
