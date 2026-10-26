import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useAppStore } from '../../stores';
import { useThemedStyles } from '../../theme';
import { Button } from '../Button';
import { applyFastestSettings } from '../../services/fastestSettings';
import { PLACE_LABEL, type ModalityPlacement } from '../../services/modalityBackends';
import { useTheme } from '../../theme';

const MODALITY_LABEL: Record<ModalityPlacement['modality'], string> = {
  llm: 'Text', image: 'Image', video: 'Video', stt: 'Speech', tts: 'Voice', embeddings: 'Search',
};
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

/**
 * "Use fastest settings": one action that measures this phone's backends on the selected model
 * (about 30 seconds, cancellable) and writes the shared table's answer. Every setting below stays
 * editable afterwards.
 */
export const FastestSettingsButton: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const modelPath = useAppStore(s => s.downloadedModels.find(m => m.id === s.activeModelId)?.filePath);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const { colors } = useTheme();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (): Promise<void> => {
    abort.current = new AbortController();
    setRunning(true);
    try {
      const outcome = await applyFastestSettings({ modelPath, signal: abort.current.signal });
      if (outcome.applied)
        setSummary(outcome.placements.map(item => `${MODALITY_LABEL[item.modality]}: ${PLACE_LABEL[item.place]}`).join(' · '));
    } finally {
      abort.current = null;
      setRunning(false);
    }
  };

  return (
    <View style={styles.container}>
      {running ? (
        <Button testID="fastest-settings-cancel" title="Measuring… Cancel" variant="outline" size="small" onPress={() => abort.current?.abort()} />
      ) : (
        <Button testID="fastest-settings-button" title="Use fastest settings" variant="primary" size="small" onPress={run} />
      )}
      {summary && !running ? (
        <Text style={{ color: colors.textSecondary }} accessibilityLiveRegion="polite" testID="fastest-settings-summary">
          {summary}
        </Text>
      ) : null}
    </View>
  );
};
