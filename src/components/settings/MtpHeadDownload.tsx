import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAppStore } from '../../stores';
import { useThemedStyles } from '../../theme';
import { Button } from '../Button';
import { downloadMtpHead, mtpHeadState } from '../../services/mtpHeads';
import { formatFileSize } from '@offgrid/models';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

/** Offers the selected model's published MTP head when it is not installed yet. */
export const MtpHeadDownload: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const model = useAppStore(s => s.downloadedModels.find(m => m.id === s.activeModelId));
  const [offer, setOffer] = useState<{ sizeBytes: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mtpHeadState(model?.filePath).then(state => {
      if (!cancelled) setOffer(state && !state.installed ? { sizeBytes: state.head.sizeBytes } : null);
    }).catch(() => { if (!cancelled) setOffer(null); });
    return () => { cancelled = true; };
  }, [model?.filePath]);

  if (!model || !offer) return null;

  const start = async (): Promise<void> => {
    setFailed(false);
    setProgress(0);
    try {
      await downloadMtpHead(model, setProgress);
      setOffer(null);
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  };

  const title = progress !== null
    ? `MTP head ${Math.round(progress * 100)}%`
    : `${failed ? 'Retry' : 'Download'} MTP head (${formatFileSize(offer.sizeBytes)})`;
  return (
    <View style={styles.container}>
      <Button testID="mtp-head-download" title={title} variant="outline" size="small" disabled={progress !== null} onPress={start} />
    </View>
  );
};
