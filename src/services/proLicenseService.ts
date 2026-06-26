/**
 * Pro entitlement, backed by Keygen license keys.
 *
 * Identity model: no login, no RevenueCat in the app. The buyer pays on the web
 * (RevenueCat checkout), an issuance Worker emails them a license key, and they
 * paste it into the app. We validate the key against Keygen (which enforces the
 * 5-device cap), cache { isPro, key, expiry } in the Keychain, and re-validate
 * when online so a revoked or expired key locks the app. Offline, the cached
 * state stands until a monthly key's expiry passes (lifetime keys never expire);
 * revocation is caught at the next online check.
 */
import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';
import {
  validateKey,
  activateMachine,
  listMachines,
  deactivateMachine,
  KeygenNetworkError,
  type KeygenMachine,
} from './keygenClient';
import { getDeviceFingerprint, getPlatformTag } from './deviceFingerprint';

const KEYCHAIN_SERVICE = 'off-grid-pro-license';

// Public web pay page (RevenueCat checkout). "Get Pro" opens this; the buyer is
// emailed a license key by the issuance Worker and enters it via activateProByKey.
export const PRO_PAY_PAGE_URL = 'https://offgridmobileai.co/pay';

export type ActivateResult = { ok: true } | { ok: false; reason: 'invalid' | 'limit' | 'network' };

type ProLicense = {
  isPro: boolean;
  key: string | null;
  licenseId: string | null;
  expiry: string | null; // ISO timestamp, or null for a perpetual (lifetime) key
  verifiedAt: number;
};

const EMPTY: ProLicense = { isPro: false, key: null, licenseId: null, expiry: null, verifiedAt: 0 };

const REVOKED_CODES = ['EXPIRED', 'SUSPENDED', 'BANNED', 'OVERDUE', 'NOT_FOUND'];
const NEEDS_ACTIVATION = ['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH'];

export type KeygenLicenseKind = ProLicense;

function setProInStore(isPro: boolean): void {
  const { useAppStore } = require('../stores/appStore');
  useAppStore.getState().setHasRegisteredPro(isPro);
}

/** Whether the cached license grants Pro right now (offline-safe). */
function isProActive(lic: ProLicense): boolean {
  if (!lic.isPro) return false;
  // Monthly keys carry an expiry — once it passes, no Pro even offline. Lifetime
  // keys have null expiry. Revocation propagates at the next online revalidate.
  if (lic.expiry && Date.parse(lic.expiry) <= Date.now()) return false;
  return true;
}

async function writeLicense(lic: ProLicense): Promise<void> {
  try {
    await Keychain.setGenericPassword('license', JSON.stringify(lic), {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
  } catch (e) {
    logger.error(`[Pro] writeLicense failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function readLicense(): Promise<ProLicense> {
  try {
    const res = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!res) return EMPTY;
    const p = JSON.parse(res.password);
    return {
      isPro: p.isPro ?? false,
      key: p.key ?? null,
      licenseId: p.licenseId ?? null,
      expiry: p.expiry ?? null,
      verifiedAt: p.verifiedAt ?? 0,
    };
  } catch (e) {
    logger.error(`[Pro] readLicense failed: ${e instanceof Error ? e.message : String(e)}`);
    return EMPTY;
  }
}

export async function readProFromKeychain(): Promise<boolean> {
  return isProActive(await readLicense());
}

export type ProTier = 'lifetime' | 'monthly';
export interface ProLicenseInfo {
  isPro: boolean;
  tier: ProTier | null; // lifetime (no expiry) vs monthly (has expiry); null when not Pro
  expiry: string | null;
  verifiedAt: number;
}

/** Cached license details for the Settings/Pro status UI (offline-safe). */
export async function getProLicenseInfo(): Promise<ProLicenseInfo> {
  const lic = await readLicense();
  const isPro = isProActive(lic);
  return {
    isPro,
    tier: !isPro ? null : lic.expiry ? 'monthly' : 'lifetime',
    expiry: lic.expiry,
    verifiedAt: lic.verifiedAt,
  };
}

/** Returns the cached entitlement immediately and revalidates in the background. */
export async function checkProStatus(): Promise<boolean> {
  const lic = await readLicense();
  revalidatePro().catch(() => {});
  return isProActive(lic);
}

/**
 * Re-check the stored key with Keygen when online. The revocation/expiry path:
 * a revoked or expired key flips the cached flag to false and locks the app.
 * Network errors are swallowed so offline users keep cached access.
 */
export async function revalidatePro(): Promise<void> {
  const lic = await readLicense();
  if (!lic.key) return; // nothing to revalidate (legacy/empty cache)
  let fp: string;
  try {
    fp = await getDeviceFingerprint();
  } catch {
    return;
  }
  try {
    const r = await validateKey(lic.key, fp);
    if (r.valid && r.code === 'VALID') {
      await writeLicense({
        isPro: true,
        key: lic.key,
        licenseId: r.license?.id ?? lic.licenseId,
        expiry: r.license?.expiry ?? null,
        verifiedAt: Date.now(),
      });
      setProInStore(true);
    } else if (REVOKED_CODES.includes(r.code)) {
      await writeLicense({ ...lic, isPro: false, expiry: r.license?.expiry ?? lic.expiry, verifiedAt: Date.now() });
      setProInStore(false);
    } else if (NEEDS_ACTIVATION.includes(r.code) && r.license) {
      // Valid key but this device lost its slot — try to reclaim it.
      const act = await activateMachine(lic.key, r.license.id, { fingerprint: fp, platform: getPlatformTag() });
      await writeLicense({
        isPro: act.ok,
        key: lic.key,
        licenseId: r.license.id,
        expiry: r.license.expiry,
        verifiedAt: Date.now(),
      });
      setProInStore(act.ok);
    }
    // TOO_MANY_MACHINES / UNKNOWN: leave the cached state untouched.
  } catch (e) {
    if (e instanceof KeygenNetworkError) return; // offline — keep cached access
    logger.error(`[Pro] revalidate error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Activate a license key on this device: validate, claim a device slot if
 * needed (Keygen enforces the 5-device cap), and cache the entitlement.
 */
export async function activateProByKey(rawKey: string): Promise<ActivateResult> {
  const key = rawKey.trim();
  if (!key) return { ok: false, reason: 'invalid' };
  let fp: string;
  try {
    fp = await getDeviceFingerprint();
  } catch {
    return { ok: false, reason: 'network' };
  }

  let r;
  try {
    r = await validateKey(key, fp);
  } catch {
    return { ok: false, reason: 'network' };
  }

  // Already activated on this device.
  if (r.valid && r.code === 'VALID' && r.license) {
    await writeLicense({ isPro: true, key, licenseId: r.license.id, expiry: r.license.expiry, verifiedAt: Date.now() });
    setProInStore(true);
    return { ok: true };
  }
  if (r.code === 'TOO_MANY_MACHINES') return { ok: false, reason: 'limit' };
  if (REVOKED_CODES.includes(r.code) || !r.license) return { ok: false, reason: 'invalid' };

  // Valid key, this device not yet activated — claim a slot.
  if (NEEDS_ACTIVATION.includes(r.code)) {
    let act;
    try {
      act = await activateMachine(key, r.license.id, { fingerprint: fp, platform: getPlatformTag() });
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (act.limitReached) return { ok: false, reason: 'limit' };
    if (!act.ok) return { ok: false, reason: 'invalid' };
    await writeLicense({ isPro: true, key, licenseId: r.license.id, expiry: r.license.expiry, verifiedAt: Date.now() });
    setProInStore(true);
    return { ok: true };
  }
  return { ok: false, reason: 'invalid' };
}

/** Devices registered on the active license (for the device-management screen). */
export async function listProDevices(): Promise<KeygenMachine[]> {
  const lic = await readLicense();
  if (!lic.key || !lic.licenseId) return [];
  try {
    return await listMachines(lic.key, lic.licenseId);
  } catch {
    return [];
  }
}

/** Free a device slot. */
export async function deactivateProDevice(machineId: string): Promise<boolean> {
  const lic = await readLicense();
  if (!lic.key) return false;
  try {
    return await deactivateMachine(lic.key, machineId);
  } catch {
    return false;
  }
}

export async function clearProForTesting(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  setProInStore(false);
}
