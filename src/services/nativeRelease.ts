import type { ResidentReclaim } from '@offgrid/models';

/**
 * What a native teardown ACHIEVED, in the engine wrappers' own terms.
 *
 * Residency needs `ResidentReclaim` - `{reclaimed: true} | {reclaimed: false, reason}` - because
 * memory it believes was reclaimed is memory it will admit the next model into: a teardown that
 * failed and said nothing produces a real overcommit. But that decision cannot be honest if the
 * layer that actually calls the engine has already thrown the answer away, and all three of
 * Mobile's engine wrappers did exactly that - each one caught the release error, logged it, and
 * cleared its own `loaded` flag in a `finally`, so "the engine still holds this" and "the engine
 * let go" were the same `Promise<void>`.
 *
 * So the wrappers answer in this app-local shape and the residency PORTS map it to the shared
 * contract. Keeping the two apart means the low-level engine wrappers do not import a residency
 * type to describe a native call, and the mapping lives at the one boundary that owes residency an
 * answer.
 *
 * `released: true` also covers "there was nothing to release". A resident whose engine holds
 * nothing must be dropped from residency, not kept: reporting `false` there would strand a phantom
 * and refuse admission forever.
 */
export interface NativeRelease {
  readonly released: boolean;
  /** For the report only. Never matched on - the boolean is the gating fact. */
  readonly reason?: string;
}

export const RELEASED: NativeRelease = { released: true };

export function notReleased(cause: unknown): NativeRelease {
  return {
    released: false,
    reason: cause instanceof Error ? cause.message : String(cause),
  };
}

/** Every part must have let go for the whole to have let go. The first refusal is the reason. */
export function allReleased(
  parts: readonly NativeRelease[],
): NativeRelease {
  const refused = parts.find(part => !part.released);
  return refused ?? RELEASED;
}

/** Convert native release proof into the one truthful answer residency accepts. */
export function nativeReleaseToResidentReclaim(
  release: NativeRelease,
): ResidentReclaim {
  return release.released
    ? { reclaimed: true }
    : {
        reclaimed: false,
        reason: release.reason ?? 'the native runtime did not release the model',
      };
}
