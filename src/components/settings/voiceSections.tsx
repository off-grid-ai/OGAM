import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import {
  VOICE_TURN_LABELS,
  VOICE_DELAY_LABELS,
  SILENCE_AFTER_SPEECH_CHOICES_MS,
  SPEAKER_DRAIN_CHOICES_MS,
  VOICE_TURN_MODES,
  speechFailureMessage,
  secondsLabel,
  type VoiceTurnMode,
} from '@offgrid/application';
import { SegmentedRow, type PillOption } from './segmentedRow';
import { useSpeechProjection } from '../../hooks/useApplicationProjection';
import { applicationFacade } from '../../services/applicationFacade';
import { useThemedStyles } from '../../theme';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

/**
 * Voice-input settings.
 *
 * Separate from textGenAdvancedSections because this is about LISTENING, not text generation - the
 * two surfaces that show it (in-chat settings and Model Settings) both sit under Transcription.
 */

/**
 * How a spoken turn begins and ends.
 *
 * Three states, not a toggle, and labelled by what HAPPENS rather than by the technique: "VAD" means
 * nothing to the person choosing it.
 *
 * Voice mode only. Chat dictation is someone typing with their voice - they pause to think
 * mid-sentence and expect the recorder to wait - so it always behaves as 'tap'.
 */
// Names, descriptions, choices and defaults come from @offgrid/speech, which owns them: desktop
// renders the same rows, and two settings screens describing one setting differently is the drift
// this prevents.
const VOICE_TURN_OPTIONS = VOICE_TURN_MODES.map(id => ({
  id,
  label: VOICE_TURN_LABELS[id].label,
}));

/** Millisecond choices rendered as pills: the id is the ms value, the label is "1s". */
const delayOptions = (choicesMs: readonly number[]): PillOption<string>[] =>
  choicesMs.map(ms => ({ id: String(ms), label: secondsLabel(ms) }));

const SILENCE_OPTIONS = delayOptions(SILENCE_AFTER_SPEECH_CHOICES_MS);
const DRAIN_OPTIONS = delayOptions(SPEAKER_DRAIN_CHOICES_MS);

export const VoiceTurnSettings: React.FC = () => {
  const preferences = useSpeechProjection().preferences;
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveOperation = useRef(0);
  const current = preferences.turnMode;
  const save = async (
    patch: Parameters<
      ReturnType<typeof applicationFacade>['speech']['savePreferences']
    >[0],
  ): Promise<void> => {
    const operation = ++saveOperation.current;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const outcome = await applicationFacade().speech.savePreferences(patch);
      if (operation === saveOperation.current && !outcome.ok) {
        setSaveMessage(speechFailureMessage(outcome.failure));
      }
    } catch (error) {
      if (operation === saveOperation.current) {
        setSaveMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operation === saveOperation.current) setIsSaving(false);
    }
  };
  return (
    <>
      <SegmentedRow<VoiceTurnMode>
        label="Voice turns"
        description={VOICE_TURN_LABELS[current].description}
        options={VOICE_TURN_OPTIONS}
        current={current}
        onSelect={turnMode => save({ turnMode })}
        testIdFor={id => `voice-turn-${id}-button`}
        isDisabled={() => isSaving}
      />
      {/* Each delay row appears only when it does something: the end-of-turn window never fires in
          tap mode, and the mic only reopens by itself in hands-free. */}
      {current !== 'tap' && (
        <SegmentedRow<string>
          label={VOICE_DELAY_LABELS.silenceAfterSpeech.label}
          description={VOICE_DELAY_LABELS.silenceAfterSpeech.description}
          options={SILENCE_OPTIONS}
          current={String(preferences.silenceAfterSpeechMs)}
          onSelect={id => save({ silenceAfterSpeechMs: Number(id) })}
          testIdFor={id => `voice-silence-${id}-button`}
          isDisabled={() => isSaving}
        />
      )}
      {current === 'handsfree' && (
        <SegmentedRow<string>
          label={VOICE_DELAY_LABELS.speakerDrain.label}
          description={VOICE_DELAY_LABELS.speakerDrain.description}
          options={DRAIN_OPTIONS}
          current={String(preferences.speakerDrainMs)}
          onSelect={id => save({ speakerDrainMs: Number(id) })}
          testIdFor={id => `voice-drain-${id}-button`}
          isDisabled={() => isSaving}
        />
      )}
      {saveMessage ? (
        <Text style={styles.warning} accessibilityLiveRegion="polite">
          {saveMessage}
        </Text>
      ) : null}
    </>
  );
};
