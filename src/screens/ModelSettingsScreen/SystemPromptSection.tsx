import React, { useCallback, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { modelsFailureMessage } from '@offgrid/application';
import { useTheme, useThemedStyles } from '../../theme';
import { APP_CONFIG } from '../../constants';
import { applicationFacade } from '../../services/applicationFacade';
import { useModelsProjection } from '../../hooks/useApplicationProjection';
import { useCommittedTextDraft } from '../../hooks/useCommittedTextDraft';
import { Button } from '../../components';
import { createStyles } from './styles';

/**
 * A LEAF draft component. Typing moves local state only; the prompt is committed once, on Save,
 * through the ONE typed settings command - so shared normalizes it (CRLF folded, whitespace
 * trimmed, a cleared prompt restored to this device's default), refuses a bad value atomically,
 * and publishes at most one mutation for a change that actually moved. A draft that differs from
 * the committed prompt only in typing noise now publishes nothing at all.
 */
export const SystemPromptSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Shared owns the committed value; this component owns only the uncommitted text draft.
  const projectedSystemPrompt = useModelsProjection().settings.systemPrompt;
  const committed = typeof projectedSystemPrompt === 'string'
    ? projectedSystemPrompt
    : APP_CONFIG.defaultSystemPrompt;
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const commit = useCallback(async (systemPrompt: string) => {
    const outcome = await applicationFacade().models.settings.save({
      patch: { systemPrompt },
    });
    if (!outcome.ok) {
      // Thrown so the draft survives with the command's own message; nothing was committed.
      throw new Error(modelsFailureMessage(outcome.failure));
    }
    // The value IS committed on this device. A failed publish is a sync warning, never a rollback.
    setSyncWarning(
      outcome.value.syncFailure
        ? `Saved on this device. Your other devices did not get it: ${modelsFailureMessage(
            outcome.value.syncFailure,
          )}`
        : null,
    );
  }, []);

  const draft = useCommittedTextDraft(committed, commit);

  return (
    <View style={styles.systemPromptContainer}>
      <Text style={styles.settingHelp}>
        Instructions given to the model before each conversation. Used when chatting without a project selected.
      </Text>
      <TextInput
        style={styles.textArea}
        value={draft.value}
        onChangeText={draft.setValue}
        multiline
        numberOfLines={4}
        placeholder="Enter system prompt..."
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="System prompt"
      />
      {draft.error ? (
        <Text style={styles.draftError} accessibilityLiveRegion="polite">
          {draft.error}
        </Text>
      ) : null}
      {!draft.error && syncWarning ? (
        <Text style={styles.draftWarning} accessibilityLiveRegion="polite">
          {syncWarning}
        </Text>
      ) : null}
      {draft.isDirty ? (
        <View style={styles.draftActions}>
          <Button
            title="Save"
            size="medium"
            onPress={draft.save}
            loading={draft.saving}
            disabled={draft.saving}
            style={styles.flex1}
            accessibilityLabel="Save system prompt"
          />
          <Button
            title="Cancel"
            variant="secondary"
            size="medium"
            onPress={draft.revert}
            disabled={draft.saving}
            style={styles.flex1}
            accessibilityLabel="Discard system prompt changes"
          />
        </View>
      ) : null}
    </View>
  );
};
