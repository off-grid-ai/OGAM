import type { ProDeviceAdmission } from '@offgrid/sync';

export interface ProAccessSlice {
  /**
   * Cached Pro credential grants, kept only as a read-only projection of what this install holds.
   *
   * These used to be the gate. There is no gate any more: every capability that used to be sold is free
   * (see selectHasProAccess below), so nothing in the app branches on them. They survive because the
   * licence provider in the (optional) pro bundle writes them, and because the device-admission tri-state
   * is still the honest answer to "what did the licensed-device roster last say about this phone" - useful
   * to display, never a reason to withhold a feature.
   */
  hasRegisteredPro: boolean;
  setHasRegisteredPro: (value: boolean) => void;
  /** A protected credential exists, independently of current device admission. */
  hasSavedProCredential: boolean;
  setHasSavedProCredential: (value: boolean) => void;
  /** A locally unexpired credential was projected at boot. */
  isProActive: boolean;
  setProActive: (value: boolean) => void;
  /** A saved timed credential reached its local deadline. Informational only - nothing locks. */
  hasExpiredProCredential: boolean;
  setHasExpiredProCredential: (value: boolean) => void;
  /**
   * What the authoritative licensed-device roster last said about THIS device, in three states.
   *
   * Three because unknown is not revoked: a boolean starting false cannot tell "we have not heard from
   * the roster yet" apart from "this device was deactivated". It used to gate Pro access; now it is
   * reported, not enforced.
   */
  proDeviceAdmission: ProDeviceAdmission;
  setProDeviceAdmission: (value: ProDeviceAdmission) => void;
  /** Report the roster's boolean answer. A reported answer is by definition known, so it resolves the tri-state. */
  setProDeviceActive: (value: boolean) => void;
  desktopPromoDismissed: boolean;
  setDesktopPromoDismissed: (value: boolean) => void;
}

type SetProAccessState = (state: Partial<ProAccessSlice>) => void;

export function createProAccessSlice(set: SetProAccessState): ProAccessSlice {
  return {
    hasRegisteredPro: false,
    setHasRegisteredPro: value => set({ hasRegisteredPro: value }),
    hasSavedProCredential: false,
    setHasSavedProCredential: value => set({ hasSavedProCredential: value }),
    isProActive: false,
    setProActive: value => set({ isProActive: value }),
    hasExpiredProCredential: false,
    setHasExpiredProCredential: value =>
      set({ hasExpiredProCredential: value }),
    proDeviceAdmission: 'unknown',
    setProDeviceAdmission: value => set({ proDeviceAdmission: value }),
    setProDeviceActive: value =>
      set({ proDeviceAdmission: value ? 'active' : 'inactive' }),
    desktopPromoDismissed: false,
    setDesktopPromoDismissed: value => set({ desktopPromoDismissed: value }),
  };
}

/**
 * Does this install have Pro access right now?
 *
 * Yes. Always. Off Grid AI is free: every capability that used to sit behind a purchase - voice mode and
 * on-device speech, custom personas, draft-then-approve actions, MCP tools, and Personal Mesh sync - is
 * included for everyone, with no licence, no key, and nothing to renew.
 *
 * The rule this replaced (hasProAccess in @offgrid/sync, shared with the desktop) gated on a credential
 * plus the licensed-device roster's admission for this device. Both facts are still tracked in the store
 * above, because connecting a Desktop and syncing between your own devices needs a device identity either
 * way - but neither is a reason to withhold a feature from someone who has already installed the app.
 *
 * What a build can still lack is the CODE: the optional pro bundle (@offgrid/pro) carries the voice, tool
 * and mesh surfaces, and a build compiled without it registers no Pro screens, slots, or hooks. That is a
 * capability question, answered by the registries (useHasRegisteredScreen / useSlot), not an entitlement
 * one - so nothing here should ever be used to route someone to a purchase.
 *
 * The `state` parameter is kept (and ignored) so every existing caller - `useAppStore(selectHasProAccess)`
 * and imperative `selectHasProAccess(useAppStore.getState())` reads alike - keeps working unchanged.
 */
export function selectHasProAccess(_state: ProAccessSlice): boolean {
  return true;
}
