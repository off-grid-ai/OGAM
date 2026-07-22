import { showAlert } from '../../components/CustomAlert';
import { backgroundDownloadService } from '../../services';
import { useDownloadStore } from '../../stores/downloadStore';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import { makeImageModelKey } from '../../utils/modelKey';
import {
  clearDownloadInProcess,
  markDownloadInProcess,
} from '../../services/inProcessDownloadRegistry';
import { ImageDownloadDeps } from './types';

// Live zip completion and relaunch recovery are two entry points into the same
// finalization state machine. Transient ownership intentionally disappears on a
// process restart, allowing recovery, while preventing the mounted screen from
// racing the in-session unzip/register path.
const liveZipFinalizations = new Set<string>();

export function isLiveImageFinalization(modelKey: string): boolean {
  return liveZipFinalizations.has(modelKey);
}

export function wireZipFinalization(
  ctx: { downloadId: string; modelId: string; deps: ImageDownloadDeps },
  onCompleteWork: () => Promise<void>,
): void {
  const { downloadId, modelId, deps } = ctx;
  const modelKey = makeImageModelKey(modelId);
  const unsubComplete = backgroundDownloadService.onComplete(
    downloadId,
    async () => {
      unsubComplete();
      unsubError();
      liveZipFinalizations.add(modelKey);
      // Mark this JS-driven finalize (unzip + register) window as live so a foreground resume during
      // it does not strand the 'processing' entry to failed — its native row is already consumed.
      markDownloadInProcess(modelKey);
      try {
        await onCompleteWork();
      } catch (error: any) {
        const message = error?.message || 'Failed to process model';
        deps.setAlertState(
          showAlert('Download Failed', getUserFacingDownloadMessage(message)),
        );
        useDownloadStore
          .getState()
          .setStatus(downloadId, 'failed', { message });
      } finally {
        liveZipFinalizations.delete(modelKey);
        clearDownloadInProcess(modelKey);
      }
    },
  );
  const unsubError = backgroundDownloadService.onError(downloadId, event => {
    unsubComplete();
    unsubError();
    deps.setAlertState(
      showAlert('Download Failed', getUserFacingDownloadMessage(event.reason)),
    );
    // The global download hook owns the failed store transition. Keeping the
    // row lets Download Manager offer Retry/Remove.
  });
}
