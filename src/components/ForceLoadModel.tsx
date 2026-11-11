import React, { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { forceLoadTextModel } from '../atlasTools/models';

const createStyles = (colors: ThemeColors) => ({
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, paddingVertical: SPACING.sm },
  label: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
  note: { ...TYPOGRAPHY.meta, color: colors.textMuted },
});

/**
 * "Load the AI model now": frees whatever else holds the memory and loads the text model, for screens that write with
 * the AI (the briefing, lessons) when it did not load by itself.
 */
export const ForceLoadModel: React.FC<{ testID?: string }> = ({ testID = 'force-load-model' }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true); setStatus('Starting...');
    forceLoadTextModel(setStatus).then(() => setStatus('The AI model is loaded.')).catch((e) => setStatus(String(e?.message || e))).finally(() => setBusy(false));
  };
  return (
    <>
      <TouchableOpacity style={styles.row} onPress={run} disabled={busy} testID={testID} accessibilityRole="button" accessibilityLabel="Load the AI model now">
        <Icon name="cpu" size={16} color={colors.primary} />
        <Text style={styles.label}>Load the AI model now</Text>
      </TouchableOpacity>
      {!!status && <Text style={styles.note} testID={`${testID}-status`}>{status}</Text>}
    </>
  );
};
