// Keychain primitives only. Every rule about the lock - when it is on, how many attempts are
// left, whether a half-written change must be undone - belongs to the Shared security owner.
// This file just reads and writes the stored passphrase, and reports refusal as `false`.
import * as Keychain from 'react-native-keychain';
import type { SecurityCredentialPort } from '@offgrid/application';
import logger from '../../../utils/logger';

const SERVICE_NAME = 'ai.offgridmobile.auth';
const PASSPHRASE_KEY = 'passphrase_hash';

function hashPassphrase(passphrase: string): string {
  let hash = 0;
  for (let i = 0; i < passphrase.length; i++) {
    const char = passphrase.codePointAt(i) ?? 0;
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const baseHash = Math.abs(hash).toString(16);
  let extendedHash = baseHash;
  for (let i = 0; i < 1000; i++) {
    let tempHash = 0;
    for (let j = 0; j < extendedHash.length; j++) {
      const char = extendedHash.codePointAt(j) ?? 0;
      tempHash = ((tempHash << 5) - tempHash) + char;
      tempHash = tempHash & tempHash;
    }
    extendedHash = Math.abs(tempHash).toString(16) + extendedHash.slice(0, 8);
  }
  return extendedHash;
}

async function readCredential(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE_NAME });
    return credentials === false ? null : credentials.password;
  } catch (error) {
    logger.error('Failed to read passphrase:', error);
    return null;
  }
}

export const mobileSecurityCredentialPort: SecurityCredentialPort = {
  async hasCredential() {
    return (await readCredential()) !== null;
  },
  async setCredential(passphrase) {
    try {
      // The keystore can REFUSE a write without throwing: it resolves `false`. Discarding that
      // value would report a save that never happened, and the next launch would find no
      // credential with the lock switched on - the user shut out of their own app.
      const saved = await Keychain.setGenericPassword(PASSPHRASE_KEY, hashPassphrase(passphrase), {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      if (saved === false) {
        logger.error('Failed to set passphrase: keychain refused the write');
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Failed to set passphrase:', error);
      return false;
    }
  },
  async verifyCredential(passphrase) {
    const stored = await readCredential();
    return stored !== null && stored === hashPassphrase(passphrase);
  },
  async removeCredential() {
    try {
      // Same contract as the write: a refusal resolves `false` rather than throwing.
      const removed = await Keychain.resetGenericPassword({ service: SERVICE_NAME });
      if (removed === false) {
        logger.error('Failed to remove passphrase: keychain refused the reset');
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Failed to remove passphrase:', error);
      return false;
    }
  },
};
