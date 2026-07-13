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
import { LoadPolicy } from './memoryBudget';

/** The one boolean→policy mapping. */
export function loadPolicyFromSettings(settings: { aggressiveModelLoading?: boolean }): LoadPolicy {
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

  let last: boolean | undefined;
  const apply = (aggressive: boolean | undefined) => {
    if (aggressive === last) return; // no-op unless the flag actually flipped
    last = aggressive;
    modelResidencyManager.setLoadPolicy(loadPolicyFromSettings({ aggressiveModelLoading: aggressive }));
  };
  // Seed from the (already hydrated) current value.
  apply(useAppStore.getState().settings?.aggressiveModelLoading);
  // Project future changes. The base store's subscribe fires on every set(); we
  // diff the one flag so setLoadPolicy runs only when it changes.
  const unsub = useAppStore.subscribe(state => apply(state.settings?.aggressiveModelLoading));
  activeUnsubscribe = () => {
    unsub();
    activeUnsubscribe = null;
  };
  return activeUnsubscribe;
}
