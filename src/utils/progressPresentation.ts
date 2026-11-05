import {
  projectProgress,
  type ProgressLike,
  type ProgressPresentation,
} from '@offgrid/ui';
import { formatBytes } from './formatBytes';

export interface MobileProgressPresentation {
  progress: ProgressPresentation;
  percentageText?: string;
  bytesText?: string;
  rateText: string;
  detailText: string;
}

/** Mobile copy for a finite byte rate; nothing when there is no rate to tell (a paused or failed
 *  download), never "Rate unavailable" noise. Input is sanitized again for safe direct use. */
export function formatByteRate(bytesPerSecond: number | undefined): string {
  if (
    bytesPerSecond === undefined ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond < 0
  ) {
    return '';
  }
  if (bytesPerSecond >= 1024 ** 3) {
    return `${(bytesPerSecond / 1024 ** 3).toFixed(1)} GB/s`;
  }
  if (bytesPerSecond >= 1024 ** 2) {
    return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

function formatByteProgress(progress: ProgressPresentation): string | undefined {
  if (progress.totalBytes !== undefined) {
    return `${formatBytes(progress.currentBytes)} / ${formatBytes(progress.totalBytes)}`;
  }
  if (progress.currentBytes > 0) {
    return formatBytes(progress.currentBytes);
  }
  return undefined;
}

/**
 * Thin Mobile rendering adapter over the shared finite progress contract.
 *
 * Sources own byte/rate measurement. Views call this once and render the same safe percentage,
 * byte detail, and rate copy. Unknown data stays unknown; no view invents a zero-byte total or
 * builds a `NaN%` string.
 */
export function presentProgress(input: ProgressLike): MobileProgressPresentation {
  const progress = projectProgress(input);
  const percentageText =
    progress.percentage === undefined
      ? undefined
      : `${Math.round(progress.percentage)}%`;
  const bytesText = formatByteProgress(progress);
  const rateText = formatByteRate(progress.bytesPerSecond);
  return {
    progress,
    percentageText,
    bytesText,
    rateText,
    detailText: [bytesText, rateText].filter(Boolean).join(' · '),
  };
}
