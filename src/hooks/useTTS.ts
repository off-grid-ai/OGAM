import { useEffect, useCallback } from 'react';
import { useTTSStore } from '../stores/ttsStore';
import { hardwareService } from '../services/hardware';
import { TTS_BLOCK_RAM_GB, TTS_WARN_RAM_GB } from '../constants/ttsModels';

export function useTTS() {
  const store = useTTSStore();

  useEffect(() => {
    store.checkDownloadStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRunOnDevice = useCallback((): { allowed: boolean; warning: boolean } => {
    const ramGB = hardwareService.getTotalMemoryGB();
    return {
      allowed: ramGB >= TTS_BLOCK_RAM_GB,
      warning: ramGB < TTS_WARN_RAM_GB,
    };
  }, []);

  const speakMessage = useCallback(
    (text: string, messageId: string) => {
      if (!store.isModelLoaded && store.isBackboneDownloaded && store.isVocoderDownloaded) {
        store.loadModels().then(() => store.speak(text, messageId));
        return;
      }
      store.speak(text, messageId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.isModelLoaded, store.isBackboneDownloaded, store.isVocoderDownloaded],
  );

  const areBothDownloaded = store.isBackboneDownloaded && store.isVocoderDownloaded;

  return {
    ...store,
    speakMessage,
    canRunOnDevice,
    areBothDownloaded,
    isDownloading: store.isDownloadingBackbone || store.isDownloadingVocoder,
    // weighted by file size (454 MB backbone, 73 MB vocoder → 86% / 14%)
    overallDownloadProgress:
      store.backboneDownloadProgress * 0.86 + store.vocoderDownloadProgress * 0.14,
    isAudioMode: store.settings.interfaceMode === 'audio',
    isChatMode: store.settings.interfaceMode === 'chat',
  };
}
