/**
 * Voice (TTS) + transcription (STT/Whisper) completed-download items for the
 * Download Manager. These models don't live in the model stores, so we read
 * them from disk: STT/Whisper is core; TTS is pro and contributes through the
 * downloads.listVoiceModels hook (absent in free builds).
 */
import { useState, useEffect, useCallback } from 'react';
import { AlertState, showAlert } from '../../components/CustomAlert';
import { whisperService } from '../../services';
import { useWhisperStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { DownloadItem, formatBytes } from './items';

async function loadItems(): Promise<DownloadItem[]> {
  const items: DownloadItem[] = [];

  try {
    const stt = await whisperService.listDownloadedModels();
    for (const m of stt) {
      items.push({
        type: 'completed', modelType: 'stt', modelId: m.modelId, fileName: m.fileName,
        author: 'Transcription', quantization: '', fileSize: m.sizeBytes,
        bytesDownloaded: m.sizeBytes, progress: 1, status: 'completed',
        filePath: m.filePath, name: m.modelId,
      });
    }
  } catch {
    // ignore — listing failures leave items empty
  }

  try {
    const pending = callHook<Promise<Array<{ engineId: string; name: string; sizeBytes: number }>>>(HOOKS.downloadsListVoiceModels);
    const voice = pending ? await pending : [];
    for (const v of voice ?? []) {
      items.push({
        type: 'completed', modelType: 'tts', modelId: v.engineId, fileName: v.name,
        author: 'Voice', quantization: '', fileSize: v.sizeBytes,
        bytesDownloaded: v.sizeBytes, progress: 1, status: 'completed', name: v.name,
      });
    }
  } catch {
    // ignore — listing failures leave items empty
  }

  return items;
}

async function deleteItem(item: DownloadItem): Promise<void> {
  if (item.modelType === 'stt') {
    // Route through whisperStore (not whisperService directly) so the deletion
    // updates presentModelIds/downloadedModelId — otherwise the Home banner and
    // Models screen keep showing the deleted model as present/active.
    await useWhisperStore.getState().deleteModelById(item.modelId);
  } else {
    const pending = callHook<Promise<void>>(HOOKS.downloadsDeleteVoiceModel, item.modelId);
    if (pending) await pending.catch(() => {});
  }
}

export interface VoiceDownloadItems {
  voiceItems: DownloadItem[];
  refreshVoiceItems: () => Promise<void>;
  /** Build the confirm-delete alert for a tts/stt item; deletes + refreshes on confirm. */
  buildDeleteAlert: (item: DownloadItem) => AlertState;
}

export function useVoiceDownloadItems(onAlertClose: () => void): VoiceDownloadItems {
  const [voiceItems, setVoiceItems] = useState<DownloadItem[]>([]);
  // Re-derives a new array reference whenever a Whisper model finishes
  // downloading or is deleted (downloadModel/deleteModelById/refreshPresentModels
  // all replace it). Subscribing here keeps the Download Manager in sync within
  // the same session — without it, the list only refreshed on mount.
  const presentModelIds = useWhisperStore((s) => s.presentModelIds);

  const refreshVoiceItems = useCallback(async () => {
    setVoiceItems(await loadItems());
  }, []);

  useEffect(() => { refreshVoiceItems(); }, [refreshVoiceItems, presentModelIds]);

  const buildDeleteAlert = useCallback((item: DownloadItem): AlertState => {
    const kind = item.modelType === 'tts' ? 'Voice' : 'Transcription';
    return showAlert(
      `Delete ${kind} Model`,
      `Are you sure you want to delete "${item.fileName}"? This will free up ${formatBytes(item.fileSize)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => { onAlertClose(); deleteItem(item).then(refreshVoiceItems); },
        },
      ],
    );
  }, [onAlertClose, refreshVoiceItems]);

  return { voiceItems, refreshVoiceItems, buildDeleteAlert };
}
