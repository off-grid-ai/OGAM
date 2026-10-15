import { AppState, type NativeEventSubscription } from 'react-native';
import { revalidateProEntitlement } from './proLicenseService';

/**
 * Keeps the cached credential and the licensed-device roster current, at launch and on every return to
 * the foreground.
 *
 * It used to be the thing that took features AWAY: a device the roster had dropped lost Pro at the next
 * revalidation. Nothing is taken away any more - Off Grid AI is free - so this is bookkeeping: the mesh
 * still needs a device identity and an honest roster to pair your own devices, and a credential that has
 * genuinely expired should be known to be expired rather than assumed. The result never gates a feature.
 */
class ProEntitlementLifecycle {
  private appStateSubscription: NativeEventSubscription | null = null;
  private launchOperation: Promise<void> | null = null;

  start(): Promise<void> {
    if (!this.appStateSubscription) {
      this.appStateSubscription = AppState.addEventListener('change', state => {
        if (state !== 'active') return;
        void revalidateProEntitlement('foreground');
      });
    }

    if (!this.launchOperation) {
      this.launchOperation = revalidateProEntitlement('launch');
    }
    return this.launchOperation;
  }
}

export const proEntitlementLifecycle = new ProEntitlementLifecycle();
