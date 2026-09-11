import RNFS from 'react-native-fs';
import { statFile } from '../../../utils/fileStat';

type CopyProgressOpts = { knownTotalBytes: number | null; onProgress?: (fraction: number) => void };

export async function copyFileWithProgress(
  source: string,
  dest: string,
  { knownTotalBytes, onProgress }: CopyProgressOpts,
): Promise<void> {
  let totalBytes = knownTotalBytes ?? 0;
  if (totalBytes === 0) {
    try {
      totalBytes = (await statFile(source))?.size ?? 0;
    } catch {
      // stat failed — progress will be indeterminate (stuck at 0%), non-fatal
    }
  }

  // A RECURSIVE timeout, not `setInterval`: the poll body awaits two filesystem calls, and an
  // interval fires again whether or not the previous tick finished. On a slow or busy filesystem
  // that stacked overlapping `exists` + `stat` pairs against the very device the copy is competing
  // for, and let a late tick report a size measured before an earlier one. One tick is in flight at
  // a time, the next is scheduled only after it settles, and `polling` stops it for good.
  let polling = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const stopPolling = (): void => {
    polling = false;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const pollOnce = async (): Promise<void> => {
    try {
      if (totalBytes > 0 && (await RNFS.exists(dest))) {
        const written = (await statFile(dest))?.size ?? 0;
        onProgress?.(Math.min(written / totalBytes, 0.99));
      }
    } catch {
      // A failed size read leaves progress where it was. The copy itself reports the real outcome.
    }
    if (polling) pollTimer = setTimeout(schedulePoll, 500);
  };

  const schedulePoll = (): void => {
    if (!polling) return;
    pollOnce().catch(() => {
      // pollOnce swallows its own failures; this only guards the scheduling call itself.
    });
  };

  pollTimer = setTimeout(schedulePoll, 500);

  try {
    await RNFS.copyFile(source, dest);
    stopPolling();
    onProgress?.(1);
  } catch (error) {
    stopPolling();
    await RNFS.unlink(dest).catch(() => {});
    throw error;
  }
}
