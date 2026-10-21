import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useAppStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import { mtpHeadState } from '../../services/mtpHeads';
import { downloadMtpHead } from '../../services/mtpHeadDownload';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

/**
 * Turning MTP on is the one tap: when the selected model has a published MTP head that is not on
 * disk yet, it downloads by itself, with its progress here. Nothing to find or press; a failed
 * download offers one retry icon.
 */
export const MtpHeadDownload: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { colors } = useTheme();
  const mtpOn = useAppStore(s => s.settings.speculativeDecoding);
  const model = useAppStore(s => s.downloadedModels.find(m => m.id === s.activeModelId));
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef<string | null>(null);

  const start = (): void => {
    if (!model) return;
    started.current = model.filePath;
    setFailed(false);
    setProgress(0);
    downloadMtpHead(model, setProgress)
      .catch(() => setFailed(true))
      .finally(() => setProgress(null));
  };

  useEffect(() => {
    if (!mtpOn || !model || started.current === model.filePath) return;
    let cancelled = false;
    mtpHeadState(model.filePath).then(state => {
      if (!cancelled && state && !state.installed) start();
    }).catch(() => {});
    return () => { cancelled = true; };
    // start reads the latest model; re-run only when MTP or the model changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtpOn, model?.filePath]);

  if (!mtpOn || (progress === null && !failed)) return null;
  return (
    <View style={styles.container} testID="mtp-head-status">
      {failed ? (
        <Icon name="refresh-cw" size={18} color={colors.primary} onPress={start} accessibilityLabel="Retry MTP head download" testID="mtp-head-retry" />
      ) : (
        <Text style={styles.desc}>{`Getting MTP head… ${Math.round((progress ?? 0) * 100)}%`}</Text>
      )}
    </View>
  );
};
