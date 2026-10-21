import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAppStore } from '../../stores';
import { useThemedStyles } from '../../theme';
import { Button } from '../Button';
import { applyFastestSettings } from '../../services/fastestSettings';
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
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (): Promise<void> => {
    abort.current = new AbortController();
    setRunning(true);
    try {
      await applyFastestSettings({ modelPath, signal: abort.current.signal });
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
    </View>
  );
};
