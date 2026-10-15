import type {
  PersonalMeshActivationResult,
  PersonalMeshReconciliationReason,
} from '@offgrid/sync';

export type ProTier = 'lifetime' | 'monthly' | 'annual' | 'subscription';

export interface ProLicenseInfo {
  isPro: boolean;
  credentialSaved?: boolean;
  expired?: boolean;
  tier: ProTier | null;
  expiry: string | null;
  verifiedAt: number;
}

/**
 * The seam the optional pro bundle uses to hand core a licence provider.
 *
 * The method list is unchanged even though nothing here gates a feature any more: the provider is what
 * keeps a cached credential and the licensed-device roster current, and Personal Mesh pairing between
 * your own devices still rides on that device identity. What the answers can no longer do is withhold a
 * capability - see selectHasProAccess in stores/proAccessSlice.
 */
export interface ProEntitlementProvider {
  readActive(): Promise<boolean>;
  getInfo(): Promise<ProLicenseInfo>;
  revalidate(reason: PersonalMeshReconciliationReason): Promise<void>;
  activate(rawCredential: string): Promise<PersonalMeshActivationResult>;
  clearForTesting(): Promise<void>;
  /**
   * Release this device's seat on its licence, then forget the credential, so the device can take a
   * different licence. Returns false when the seat could not be released - the credential is kept in
   * that case, because a device that still holds a seat has not been reset.
   *
   * Distinct from clearForTesting, which only forgets locally and leaves the seat where it is.
   */
  resetCurrentDevice(): Promise<boolean>;
}

/**
 * The provider a build without the pro bundle registers: nothing held, nothing to read.
 *
 * These answers are FACTS about this install, never verdicts on what it may do. A build like this one
 * simply has no licence plumbing, and every feature core can offer is offered anyway.
 */
const UNAVAILABLE_PROVIDER: ProEntitlementProvider = {
  readActive: async () => false,
  getInfo: async () => ({
    isPro: false,
    credentialSaved: false,
    expired: false,
    tier: null,
    expiry: null,
    verifiedAt: 0,
  }),
  revalidate: async () => undefined,
  activate: async () => ({ ok: false, reason: 'registration_failed' }),
  clearForTesting: async () => undefined,
  // An open-core build holds no credential, so there is nothing to release and nothing to forget.
  // Reporting success is truthful here: the device is already in the state a reset would leave it in.
  resetCurrentDevice: async () => true,
};

let provider: ProEntitlementProvider = UNAVAILABLE_PROVIDER;

export function registerProEntitlementProvider(
  nextProvider: ProEntitlementProvider,
): void {
  provider = nextProvider;
}

export function getProLicenseInfo(): Promise<ProLicenseInfo> {
  return provider.getInfo();
}

export function revalidateProEntitlement(
  reason: PersonalMeshReconciliationReason,
): Promise<void> {
  return provider.revalidate(reason);
}

/**
 * Activate a licence key on this device, through whatever provider is registered.
 *
 * Kept for the device-roster path: a key imported from a paired device, or re-entered by someone who
 * bought before Off Grid AI became free, still claims a seat and writes the credential. No screen in
 * this app asks for a key any more, because there is nothing to buy.
 */
export function activateProByKey(
  rawCredential: string,
): Promise<PersonalMeshActivationResult> {
  return provider.activate(rawCredential);
}
