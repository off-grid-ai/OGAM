/**
 * The real licence stack, connected the way the app connects it at boot.
 *
 * The real pro package hands its licence provider to proLicenseService (as loadProFeatures does), and the
 * pairing entitlement host that syncService prepares owns activation. Both are real; only their UI
 * callbacks are dropped. Keygen itself is faked at the HTTP boundary (keygenFake) and the keychain is the
 * device. Returns the call that disconnects the activation owner again.
 */
export function connectLicenceStack(
  localDevice: { syncDeviceId: string; deviceName: string; platform: 'ios' | 'android' } = {
    syncDeviceId: 'this-phone',
    deviceName: 'This phone',
    platform: 'android',
  },
): () => void {
  const service = require('../../src/services/proLicenseService');
  require('@offgrid/pro').configureProEntitlementProvider(service.registerProEntitlementProvider);
  const {
    createPairingEntitlementHostAdapter,
  } = require('../../pro/sync/pairingEntitlementCredentialAdapter');
  const { setDirectEntitlementActivationOwner } = require('../../pro/licensing/proLicenseProvider');
  return setDirectEntitlementActivationOwner(
    createPairingEntitlementHostAdapter({
      localDevice,
      membershipOwner: () => undefined,
      onReconciliationChanged: () => undefined,
      onLocalAdmissionChanged: () => undefined,
      onRegistryChanged: async () => undefined,
    }),
  );
}
