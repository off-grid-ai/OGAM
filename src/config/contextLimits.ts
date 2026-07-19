const BYTES_PER_GB = 1024 * 1024 * 1024;

/** The largest context this runtime will allocate for a device's physical RAM tier. */
export function getDeviceContextLimit(totalMemoryBytes: number): number {
  const gb = totalMemoryBytes / BYTES_PER_GB;
  if (gb <= 6) return 2048;
  if (gb <= 8) return 4096;
  return 8192;
}

/** A model's trained maximum is capability metadata, not an allocation recommendation. */
export function getSelectableContextLimit(
  modelMaxContext: number | null,
  totalMemoryBytes: number,
): number {
  const deviceLimit = getDeviceContextLimit(totalMemoryBytes);
  return modelMaxContext == null
    ? deviceLimit
    : Math.min(modelMaxContext, deviceLimit);
}
