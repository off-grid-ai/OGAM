import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { modelsFailureMessage } from '@offgrid/application';
import { useModelsProjection } from '../../hooks/useApplicationProjection';
import { applicationFacade } from '../../services/applicationFacade';
import { useThemedStyles } from '../../theme';
import { SegmentedRow, BOOL_OPTIONS } from './segmentedRow';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

/**
 * MTP speculative decoding. The model drafts several tokens per step and verifies them in a single
 * pass, so a turn finishes in fewer forward passes — the win is wall-clock, not quality: verified
 * tokens are exactly the tokens the model would have produced anyway.
 *
 * Only models shipped with MTP draft layers can do it. The engine silently never drafts on the
 * rest, so this is a preference rather than a promise, and the copy says so instead of claiming a
 * speed-up every model will deliver.
 */
export const SpeculativeDecodingToggle: React.FC = () => {
  const speculativeDecoding =
    useModelsProjection().settings.speculativeDecoding === true;
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const isSavingRef = useRef(false);

  const save = async (enabled: boolean): Promise<void> => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const outcome = await applicationFacade().models.settings.save({
        patch: { speculativeDecoding: enabled },
      });
      if (!outcome.ok) {
        setSaveMessage(modelsFailureMessage(outcome.failure));
        return;
      }
      if (outcome.value.syncFailure) {
        setSaveMessage(
          `Saved on this device. ${modelsFailureMessage(outcome.value.syncFailure)}`,
        );
      }
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <SegmentedRow<'off' | 'on'>
      label="Speculative Decoding (MTP)"
      description="Drafts several tokens per step and checks them together. Faster on models built with MTP layers; no effect on others. Requires model reload."
      options={BOOL_OPTIONS}
      current={speculativeDecoding ? 'on' : 'off'}
      onSelect={(id) => save(id === 'on')}
      testIdFor={(id) => `speculative-${id}-button`}
      isDisabled={() => isSaving}
    >
      {saveMessage ? (
        <Text style={styles.warning} accessibilityLiveRegion="polite">
          {saveMessage}
        </Text>
      ) : null}
    </SegmentedRow>
  );
};
