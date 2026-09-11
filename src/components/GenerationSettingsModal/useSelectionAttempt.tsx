import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { modelSelectionFailureMessage } from '../../services';
import { createStyles } from './styles';

// ─── Selection Attempt (transient UI state for one canonical command) ─────────

/**
 * One in-flight selection command. This is view state for a single tap, never a second owner of
 * the selection: the canonical Models selection stays the only truth about which model is picked.
 */
type SelectionAttempt =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'failed'; readonly message: string };

type SelectionCommand = () => Promise<void>;

/**
 * Runs one selection command, keeps the picker open while it is in flight, and calls `onSettled`
 * only after the owner confirms the selection. A typed refusal becomes the owner's message plus a
 * retry of the exact same command.
 */
export function useSelectionAttempt(onSettled: () => void) {
  const [attempt, setAttempt] = useState<SelectionAttempt>({ status: 'idle' });
  const [lastCommand, setLastCommand] = useState<SelectionCommand | null>(null);

  const run = useCallback(
    (command: SelectionCommand) => {
      setLastCommand(() => command);
      setAttempt({ status: 'pending' });
      command().then(
        () => {
          setAttempt({ status: 'idle' });
          setLastCommand(null);
          onSettled();
        },
        (cause: unknown) => {
          setAttempt({
            status: 'failed',
            message: modelSelectionFailureMessage(cause),
          });
        },
      );
    },
    [onSettled],
  );

  const retry = useCallback(() => {
    if (lastCommand) run(lastCommand);
  }, [lastCommand, run]);

  return { attempt, run, retry, canRetry: lastCommand !== null };
}

export const SelectionAttemptNotice: React.FC<{
  attempt: SelectionAttempt;
  canRetry: boolean;
  onRetry: () => void;
  testIDPrefix: string;
}> = ({ attempt, canRetry, onRetry, testIDPrefix }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (attempt.status === 'pending') {
    return (
      <Text
        style={styles.modelPickerItemDesc}
        testID={`${testIDPrefix}-selection-pending`}
      >
        Applying selection…
      </Text>
    );
  }
  if (attempt.status === 'idle') return null;

  return (
    <View testID={`${testIDPrefix}-selection-failed`}>
      <Text style={[styles.modelPickerItemDesc, { color: colors.error }]}>
        {attempt.message}
      </Text>
      {canRetry && (
        <TouchableOpacity
          onPress={onRetry}
          testID={`${testIDPrefix}-selection-retry`}
        >
          <Text style={[styles.modelPickerItemDesc, { color: colors.primary }]}>
            Retry
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
