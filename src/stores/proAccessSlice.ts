import { hasProAccess, type ProDeviceAdmission } from '@offgrid/application';

export interface ProAccessSlice {
  /** Cached protected Pro credential grants offline feature access. */
  hasRegisteredPro: boolean;
  setHasRegisteredPro: (value: boolean) => void;
  /** A protected credential exists, independently of current device admission. */
  hasSavedProCredential: boolean;
  setHasSavedProCredential: (value: boolean) => void;
  /** Paid features are available through a credential or Debug developer access. */
  isProActive: boolean;
  setProActive: (value: boolean) => void;
  /** A saved timed credential reached its local deadline and must show the purchase route. */
  hasExpiredProCredential: boolean;
  setHasExpiredProCredential: (value: boolean) => void;
  /**
   * What the authoritative licensed-device roster last said about THIS device, in three states.
   *
   * Three because unknown is not revoked: a boolean starting false cannot tell "we have not heard from
   * the roster yet" apart from "this device was deactivated". Gating on it directly would revoke Pro on
   * every cold start and for anyone offline; gating on the credential alone leaves a deactivated device
   * fully Pro, which is what it did.
   *
   * The ONLY admission state there is. It used to be shadowed by an `isProDeviceActive` boolean, which
   * meant two fields to keep in step and, once admission was persisted and the boolean was not, a
   * restart that put them in open contradiction - Pro granted while the header read "Device Not Active".
   */
  proDeviceAdmission: ProDeviceAdmission;
  setProDeviceAdmission: (value: ProDeviceAdmission) => void;
  /** Report the roster's boolean answer. A reported answer is by definition known, so it resolves the tri-state. */
  setProDeviceActive: (value: boolean) => void;
  devProDisabled: boolean;
  setDevProDisabled: (value: boolean) => void;
  proBannerDismissed: boolean;
  setProBannerDismissed: (value: boolean) => void;
  desktopPromoDismissed: boolean;
  setDesktopPromoDismissed: (value: boolean) => void;
  proAhaTriggeredBy: 'image' | 'text' | null;
  setProAhaTriggeredBy: (value: 'image' | 'text' | null) => void;
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
    setHasExpiredProCredential: value => set({ hasExpiredProCredential: value }),
    proDeviceAdmission: 'unknown',
    setProDeviceAdmission: value => set({ proDeviceAdmission: value }),
    setProDeviceActive: value =>
      set({ proDeviceAdmission: value ? 'active' : 'inactive' }),
    devProDisabled: false,
    setDevProDisabled: value => set({ devProDisabled: value }),
    proBannerDismissed: false,
    setProBannerDismissed: value => set({ proBannerDismissed: value }),
    desktopPromoDismissed: false,
    setDesktopPromoDismissed: value => set({ desktopPromoDismissed: value }),
    proAhaTriggeredBy: null,
    setProAhaTriggeredBy: value => set({ proAhaTriggeredBy: value }),
  };
}

/**
 * Does this install have Pro access right now?
 *
 * The RULE is hasProAccess in @offgrid/sync, shared with the desktop - two implementations of "is this
 * device still paid for" would eventually disagree about a live device. This only supplies the store's
 * facts to it: what credential exists, and what the roster last said about this device.
 */
export function selectHasProAccess(state: ProAccessSlice): boolean {
  return hasProAccess({
    // A saved key is not proof of current access. The provider projects only a
    // locally unexpired credential into hasRegisteredPro/isProActive.
    hasCredential: state.hasRegisteredPro || state.isProActive,
    admission: state.proDeviceAdmission,
  });
}
