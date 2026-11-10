import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import { selectIsLiteRT, useAppStore } from '../../stores';
import { useThemedStyles } from '../../theme';
import { SPACING } from '../../constants';
import { applyFastestSettings } from '../../services/fastestSettings';
import { PLACE_LABEL, type ModalityPlacement } from '../../services/modalityBackends';

const MODALITY_LABEL: Record<ModalityPlacement['modality'], string> = {
  llm: 'Text', image: 'Image', video: 'Video', stt: 'Speech', tts: 'Voice', embeddings: 'Search',
  // Desktop-only modalities; a phone never places these.
  grounding: 'Grounding', decision: 'Decision',
};
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

const SUMMARY_GAP = { marginTop: SPACING.sm };

/**
 * "Fastest settings": one action that measures this phone's backends on the selected model
 * (about 30 seconds, cancellable) and writes the shared table's answer. Every setting below stays
 * editable afterwards. It is a setting like the others in the card (a name, one line, a full-width
 * button), not a lone button above it (Mac, 2026-11-08: a component hanging on the left looked wrong).
 */
export const FastestSettingsButton: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const modelPath = useAppStore(s => s.downloadedModels.find(m => m.id === s.activeModelId)?.filePath);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // A LiteRT text model picks its own backend; there is nothing to measure.
  const isLiteRT = useAppStore(selectIsLiteRT);

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

  if (isLiteRT) return null;
  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.label}>Fastest settings</Text>
        <Text style={styles.desc}>Measures this phone with your model in about 30 seconds. You can still change each setting.</Text>
      </View>
      <View style={styles.buttons}>
        <TouchableOpacity
          testID={running ? 'fastest-settings-cancel' : 'fastest-settings-button'}
          style={[styles.button, running && styles.buttonActive]}
          onPress={running ? () => abort.current?.abort() : run}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, running && styles.buttonTextActive]} numberOfLines={1}>
            {running ? 'Measuring… Cancel' : 'Measure and apply'}
          </Text>
        </TouchableOpacity>
      </View>
      {summary && !running ? (
        <Text style={[styles.desc, SUMMARY_GAP]} accessibilityLiveRegion="polite" testID="fastest-settings-summary">
          {summary}
        </Text>
      ) : null}
    </View>
  );
};
