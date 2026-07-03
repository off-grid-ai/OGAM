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
import { modelDownloadService } from '../../services/modelDownloadService';
import { isModelDownloadInProgress } from '../../services/modelDownloadService/storeStatus';
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
    // SINGLE source of truth for TTS (Kokoro) state — the SAME ModelDownloadService
    // (ttsProvider) the Voice Models panel reads via useModelDownloads. The Download
    // Manager used to read a parallel `downloads.listVoiceModels` hook with `?? 1`
    // defaulting, so a flaky/stale executorch disk probe made it show "completed 82MB"
    // while the panel (service) correctly showed it downloading 0% — the mismatch.
    // Reading the one projection makes divergence impossible.
    const tts = (await modelDownloadService.list()).filter(d => d.modelType === 'tts');
    for (const d of tts) {
      const engineId = d.id.replace(/^tts:/, '');
      if (d.status === 'completed') {
        items.push({
          type: 'completed', modelType: 'tts', modelId: engineId, fileName: d.name,
          author: 'Voice', quantization: '', fileSize: d.sizeBytes,
          bytesDownloaded: d.sizeBytes, progress: 1, status: 'completed', name: d.name,
        });
      } else if (isModelDownloadInProgress(d.status)) {
        items.push({
          type: 'active', modelType: 'tts', modelId: engineId, fileName: d.name,
          author: 'Voice', quantization: '', fileSize: d.sizeBytes,
          bytesDownloaded: d.bytesDownloaded, progress: d.progress, status: 'downloading', name: d.name,
        });
      } else if (d.status === 'error') {
        // A failed Kokoro fetch. Surface it as a failed active item so the
        // Download Manager shows it with a Retry button (executorch resumes from
        // its cache); the Retry action routes back through
        // modelDownloadService.retry() → ttsProvider.retry() → downloadAssets().
        // Prefer the engine's own message: when d.error is present, leave
        // reasonCode undefined so getDownloadStatusLabel shows that text rather
        // than the canned message a known code maps to. Retry still renders
        // because isRetryable(undefined) === true. Fall back to the retryable
        // 'download_interrupted' code only when the engine gave no message.
        items.push({
          type: 'active', modelType: 'tts', modelId: engineId, fileName: d.name,
          author: 'Voice', quantization: '', fileSize: d.sizeBytes,
          bytesDownloaded: d.bytesDownloaded, progress: d.progress, status: 'failed', name: d.name,
          reason: d.error,
          ...(d.error ? {} : { reasonCode: 'download_interrupted' as const }),
        });
      }
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

  // Stay in lockstep with the Voice panel: both observe ModelDownloadService, so a
  // TTS phase change (download start/finish/delete) refreshes this list the same way
  // it updates the panel — no stale "completed" snapshot can linger.
  useEffect(() => modelDownloadService.subscribe(() => { refreshVoiceItems(); }), [refreshVoiceItems]);

  // Kokoro's download has no store to subscribe to (it's executorch's own fetcher),
  // so while a voice model is actively downloading, poll to advance its progress
  // bar in the Download Manager. Gate on the in-progress status specifically — a
  // failed item is also type:'active' (so ActiveDownloadCard renders its Retry),
  // but it's terminal and must NOT keep an 800ms interval alive.
  useEffect(() => {
    if (!voiceItems.some((i) => i.type === 'active' && i.status === 'downloading')) return;
    const t = setInterval(() => { refreshVoiceItems(); }, 800);
    return () => clearInterval(t);
  }, [voiceItems, refreshVoiceItems]);

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
