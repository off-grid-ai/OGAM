/**
 * Single source of truth for the human-readable label of an image-generation backend.
 *
 * The same coreml/qnn/mnn → "Core ML"/"NPU"/"GPU" mapping was duplicated across the
 * Models tab, the image filter bar, the Download Manager, Storage Settings and the
 * filter constants — and had already drifted (Storage Settings showed "Qualcomm NPU"
 * while every other surface showed "NPU"). Define it once; every surface calls this so
 * the label can't diverge again.
 *
 * `fallback` is the label for an unknown/absent backend — it differs by surface (a model
 * author line wants "GPU", a filter chip wants "Backend"), so callers pass their own.
 */
export function imageBackendLabel(
  backend: string | undefined | null,
  fallback: string = 'GPU',
): string {
  switch (backend) {
    case 'coreml':
      return 'Core ML';
    case 'qnn':
      return 'NPU';
    case 'mnn':
      return 'GPU';
    default:
      return fallback;
  }
}
