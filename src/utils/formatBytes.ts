/**
 * Canonical byte formatter — the SINGLE source of truth for "X MB / Y GB" strings.
 *
 * Three near-identical copies had drifted (GB at 2 vs 1 decimals, MB at 1 vs 0),
 * so the same download rendered differently across the Models tab, the model cards,
 * and the Download Manager. Defined once here; every surface imports this so a
 * download's size reads the same everywhere.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}
