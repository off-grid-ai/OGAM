import RNFS from 'react-native-fs';
import { formatFileSize } from '@offgrid/models';

/** Room kept free past a download, so the phone itself never runs out mid-write. */
const FREE_SPACE_MARGIN_BYTES = 500 * 1024 * 1024;

class NotEnoughSpaceError extends Error {
  readonly code = 'disk_full';
  constructor(readonly neededBytes: number, readonly freeBytes: number) {
    super(`Not enough space. This needs ${formatFileSize(neededBytes)} and your phone has ${formatFileSize(freeBytes)} free. Free up space in Settings → Storage, then try again.`);
    this.name = 'NotEnoughSpaceError';
  }
}

/**
 * Check free storage before a download starts, instead of failing at 90% when the disk fills.
 * An unreadable reading never blocks a download: the native downloader still reports a full disk.
 */
export async function assertFreeSpace(bytes: number | undefined): Promise<void> {
  if (!bytes || bytes <= 0) return;
  let free: number;
  try {
    free = (await RNFS.getFSInfo()).freeSpace;
  } catch {
    return;
  }
  if (!Number.isFinite(free)) return;
  if (free < bytes + FREE_SPACE_MARGIN_BYTES) throw new NotEnoughSpaceError(bytes + FREE_SPACE_MARGIN_BYTES, free);
}
