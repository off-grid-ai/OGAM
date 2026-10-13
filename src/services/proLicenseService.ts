import type {
  PersonalMeshActivationResult,
  PersonalMeshReconciliationReason,
} from '@offgrid/sync';

export const PRO_PAY_PAGE_URL = 'https://getoffgridai.co/pay/';

export type ProTier = 'lifetime' | 'monthly' | 'annual' | 'subscription';

export const PRO_TIER_META: Record<
  ProTier,
  { label: string; renews: boolean }
> = {
  lifetime: { label: 'Lifetime', renews: false },
  monthly: { label: 'Monthly', renews: true },
  annual: { label: 'Annual', renews: true },
  subscription: { label: 'Subscription', renews: true },
};

export interface ProLicenseInfo {
  isPro: boolean;
  credentialSaved?: boolean;
  expired?: boolean;
  tier: ProTier | null;
  expiry: string | null;
  verifiedAt: number;
}

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

export function activateProByKey(
  rawCredential: string,
): Promise<PersonalMeshActivationResult> {
  return provider.activate(rawCredential);
}

export function clearProForTesting(): Promise<void> {
  return provider.clearForTesting();
}

export function resetProOnThisDevice(): Promise<boolean> {
  return provider.resetCurrentDevice();
}
