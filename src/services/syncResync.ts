// A tiny core→pro bridge for an on-demand "catch up now" resync.
//
// Core surfaces (e.g. the Day screen's manual refresh) must be able to ask sync to re-pull from every
// connected peer, but core can't import the pro-only sync service (pro depends on core, not the reverse).
// So pro registers the real implementation at startup and core calls through this seam — the same
// provider pattern used for the Pro entitlement check.

let resyncImpl: (() => void) | null = null;

/** Pro registers how to resync (ask every connected peer to re-sync). Called once during pro startup. */
export function registerSyncResync(fn: () => void): void {
  resyncImpl = fn;
}

/** Core calls this to force an immediate catch-up. No-op before pro has registered (or in free builds). */
export function requestSyncResync(): void {
  resyncImpl?.();
}
