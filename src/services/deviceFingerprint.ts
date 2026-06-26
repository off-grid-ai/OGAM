/**
 * Device fingerprint for Keygen machine activation.
 *
 * A stable, random per-install identifier, persisted in the Keychain so a
 * reinstall reuses the SAME fingerprint and reclaims its Keygen machine slot
 * instead of burning a new one (otherwise reinstallers hit the device cap and
 * get falsely blocked). It is not derived from any hardware/OS identifier, so
 * nothing identifying about the device leaves the device.
 */
import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';

const FINGERPRINT_SERVICE = 'off-grid-device-fingerprint';

/** 16 random bytes as hex, via Web Crypto when available, else a timestamp mix. */
function randomFingerprint(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback (older Hermes without Web Crypto): not cryptographically strong,
  // but only needs to be unique-per-install, which this is in practice.
  return `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffffff).toString(16)}`; // NOSONAR
}

let cached: string | null = null;

/** The stable fingerprint for this install, generating + persisting it once. */
export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  try {
    const existing = await Keychain.getGenericPassword({ service: FINGERPRINT_SERVICE });
    if (existing && existing.password) {
      cached = existing.password;
      return cached;
    }
  } catch (e) {
    logger.error(`[Fingerprint] read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const fp = randomFingerprint();
  try {
    await Keychain.setGenericPassword('fingerprint', fp, {
      service: FINGERPRINT_SERVICE,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
  } catch (e) {
    // If persistence fails the fingerprint is unstable across launches, which at
    // worst consumes extra device slots — log and continue rather than block Pro.
    logger.error(`[Fingerprint] persist failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  cached = fp;
  return fp;
}

/** Platform tag stored on the Keygen machine for desktop/mobile analytics. */
export function getPlatformTag(): string {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return Platform.OS; // macos / windows (Off Grid Desktop) / web
}
