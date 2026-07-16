/**
 * iOS image-download retry — the ONE retry path that is genuinely UI-coupled (it pops
 * alerts and resumes finalization), so the image DownloadProvider delegates it back
 * here through ModelDownloadService's injected image ops. This module is
 * platform-AGNOSTIC: the Android-vs-iOS retry decision now lives inside
 * imageProvider.retry() (Android resumes the native row directly; iOS routes here).
 * Text / STT retry are owned by their providers too — per CLAUDE.md, retry mechanism
 * selection does not belong in the presentation layer. `parseEntryMetadata` stays
 * because the Download Manager's item mapping uses it.
 */
import { AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { DownloadEntry } from '../../stores/downloadStore';
import { backgroundDownloadService } from '../../services';
import { DownloadItem } from './items';
import logger from '../../utils/logger';
import { proceedWithDownload } from '../ModelsScreen/imageDownloadActions';
import { imageDescriptorFromMetadata } from '../ModelsScreen/imageDescriptor';
import { resumeImageDownload } from '../ModelsScreen/imageDownloadResume';

export function parseEntryMetadata(entry: DownloadEntry): Record<string, any> | null {
  if (!entry.metadataJson) return null;
  try {
    return JSON.parse(entry.metadataJson);
  } catch {
    return null;
  }
}

async function resumeImageFinalization(
  entry: DownloadEntry,
  setAlertState: (state: AlertState) => void,
): Promise<void> {
  const appState = useAppStore.getState();
  await resumeImageDownload(entry, {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    setActiveImageModelId: appState.setActiveImageModelId,
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  });
}

async function retryIosImageDownload(entry: DownloadEntry, setAlertState: (s: AlertState) => void): Promise<void> {
  const meta = parseEntryMetadata(entry);
  if (!meta) return;
  const isZip = meta.imageDownloadType === 'zip';
  if (isZip && !meta.imageModelDownloadUrl) {
    logger.error('[DownloadManager] retryIosImageDownload: missing imageModelDownloadUrl for zip download', { modelId: entry.modelId });
    return;
  }
  // Cancel the stale native row so it doesn't accumulate in the native DB across
  // retries. proceedWithDownload starts a fresh row.
  await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
  const modelId = entry.modelId.replace('image:', '');
  const appState = useAppStore.getState();
  const deps = {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    setActiveImageModelId: appState.setActiveImageModelId,
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  };
  await proceedWithDownload(imageDescriptorFromMetadata(modelId, meta), deps);
}

/**
 * An image download whose bytes are all present (or already 'processing') just needs
 * its post-download finalization re-run, not a fresh download. Returns true when it
 * handled the retry so the caller can stop.
 */
async function tryResumeImageFinalization(
  item: DownloadItem,
  entry: DownloadEntry | undefined,
  setAlertState: (s: AlertState) => void,
): Promise<boolean> {
  if (!entry) return false;
  const hasAllBytes = item.fileSize > 0 && item.bytesDownloaded >= item.fileSize;
  let nativeMainStatus: string | undefined;
  try {
    const activeRows = await backgroundDownloadService.getActiveDownloads();
    nativeMainStatus = activeRows.find(row => row.downloadId === item.downloadId)?.status;
  } catch {
    // Best-effort native state check only.
  }
  if (item.status === 'processing' || hasAllBytes || nativeMainStatus === 'completed') {
    await resumeImageFinalization(entry, setAlertState);
    return true;
  }
  return false;
}

/**
 * The iOS image retry path: re-run finalization when the bytes are present, else
 * re-start the download (foreground URLSession can't be resumed). Stays in the
 * presentation layer only because it needs alerts + finalization-resume; the image
 * provider delegates here (iOS only — Android resumes natively in the provider).
 * Throws on failure so the caller can mark the row failed.
 */
export async function retryImageDownload(
  item: DownloadItem,
  entry: DownloadEntry | undefined,
  setAlertState: (s: AlertState) => void,
): Promise<void> {
  logger.log('[DownloadDebug] Image retry requested', { modelKey: item.modelKey, modelId: item.modelId, status: item.status });
  if (await tryResumeImageFinalization(item, entry, setAlertState)) return;
  if (entry) await retryIosImageDownload(entry, setAlertState);
  backgroundDownloadService.startProgressPolling();
}
