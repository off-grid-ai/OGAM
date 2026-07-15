/**
 * Load-policy projection — the SINGLE place the persisted "aggressive model
 * loading" setting is mapped to the residency manager's runtime LoadPolicy.
 *
 * Separation of concerns (MVVM-ish):
 *  - Views (the Settings screen AND the in-chat quick settings) only dispatch an
 *    intent: `updateSettings({ aggressiveModelLoading })`. They never touch the
 *    residency manager or compute a policy themselves — so the two surfaces can't
 *    drift.
 *  - This module PROJECTS that one setting onto the service that owns the runtime
 *    policy (modelResidencyManager). The boolean→policy mapping lives here, once.
 *  - The service (modelResidencyManager) owns the authoritative policy + memory
 *    math; imperative load decisions read it from the service, never from a
 *    reactive store snapshot.
 */
import { useAppStore } from '../stores';
import { modelResidencyManager } from './modelResidency';
import { activeModelService } from './activeModelService';
import { LoadPolicy } from './memoryBudget';

/** The one setting→policy mapping. Prefer the explicit 3-mode setting; fall back to
 *  the legacy aggressiveModelLoading boolean so pre-migration installs still work. */
export function loadPolicyFromSettings(settings: {
  modelLoadingMode?: LoadPolicy;
  aggressiveModelLoading?: boolean;
}): LoadPolicy {
  if (settings.modelLoadingMode) return settings.modelLoadingMode;
  return settings.aggressiveModelLoading ? 'aggressive' : 'balanced';
}

/**
 * Push the current setting into the manager and keep it in sync on every change.
 * SINGLETON: safe to call more than once — App's boot effect can re-run (its
 * useCallback deps change), and a naive subscribe would then stack listeners and
 * leak for the app lifetime (one setLoadPolicy per listener per set()). Repeated
 * calls return the SAME live unsubscribe; the underlying store subscription is
 * created exactly once. Returns an unsubscribe fn (which also clears the singleton).
 */
let activeUnsubscribe: (() => void) | null = null;

export function startLoadPolicySync(): () => void {
  if (activeUnsubscribe) return activeUnsubscribe; // already syncing — don't stack

  let last: LoadPolicy | undefined;
  const apply = (
    settings: { modelLoadingMode?: LoadPolicy; aggressiveModelLoading?: boolean } | undefined,
  ) => {
    // Resolve through the ONE mapping (prefers the explicit 3-mode setting, falls back to
    // the legacy boolean) and diff on the RESULTING policy — so BOTH the new mode selector
    // (modelLoadingMode) and the legacy toggle drive the manager, and setLoadPolicy runs
    // only when the effective policy actually changes.
    const policy = loadPolicyFromSettings(settings ?? {});
    if (policy === last) return;
    const isInitialSeed = last === undefined;
    last = policy;
    modelResidencyManager.setLoadPolicy(policy);
    // On a USER change of the loading mode (not the boot seed), eject EVERY resident so the new
    // policy takes effect immediately — each selected model lazily reloads on next use under the
    // new mode. setLoadPolicy only governs FUTURE loads, so without this, switching to Lean with
    // several models already resident left them all in memory until the next load (device 2026-07-14).
    // ejectAll keeps the selections (rows still show the chosen models); it only frees RAM.
    if (!isInitialSeed) {
      void activeModelService.ejectAll().catch(() => { /* eviction is best-effort; next load re-enforces */ });
    }
  };
  // Seed from the (already hydrated) current value.
  apply(useAppStore.getState().settings);
  // Project future changes. The base store's subscribe fires on every set(); we
  // diff the resolved policy so setLoadPolicy runs only when it changes.
  const unsub = useAppStore.subscribe(state => apply(state.settings));
  activeUnsubscribe = () => {
    unsub();
    activeUnsubscribe = null;
  };
  return activeUnsubscribe;
}
