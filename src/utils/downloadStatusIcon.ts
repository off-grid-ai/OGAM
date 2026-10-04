/**
 * The ONE status -> Feather-icon mapping for a download, so the Download Manager row
 * (items.tsx) and the model list card (ModelCard) show the SAME glyph for the same
 * state and can't drift.
 *
 * Queued used to be the odd one out — text-only ("Queued", no icon) while every other
 * state was icon-coded (error/retry/network). A clock reads as "waiting for a slot" at a
 * glance, which is what a queued download is. Feather only; no bold.
 */
export type DownloadStatusIcon = 'clock' | 'alert-circle' | 'refresh-cw' | 'wifi-off' | 'pause-circle';

/** The queued indicator, exported so a boolean-`queued` caller (ModelCard) uses the same glyph. */
export const QUEUED_ICON: DownloadStatusIcon = 'clock';
/** The paused indicator: a person stopped this on purpose, so it is neither waiting nor broken. */
export const PAUSED_ICON: DownloadStatusIcon = 'pause-circle';

export function downloadStatusIcon(status: string): DownloadStatusIcon | null {
  if (status === 'pending' || status === 'queued') return QUEUED_ICON;
  if (status === 'paused') return PAUSED_ICON;
  if (status === 'failed') return 'alert-circle';
  if (status === 'retrying') return 'refresh-cw';
  if (status === 'waiting_for_network') return 'wifi-off';
  return null;
}
