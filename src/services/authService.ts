import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';

const SERVICE_NAME = 'ai.offgridmobile.auth';
const PASSPHRASE_KEY = 'passphrase_hash';

class AuthService {
  private hashPassphrase(passphrase: string): string {
    // Simple hash - in production, consider using bcrypt via native module
    // We use a deterministic hash since we're comparing hashes
    let hash = 0;
    for (let i = 0; i < passphrase.length; i++) {
      const char = passphrase.codePointAt(i) ?? 0;
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // Add some complexity with multiple rounds
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

  async setPassphrase(passphrase: string): Promise<boolean> {
    try {
      const hash = this.hashPassphrase(passphrase);
      await Keychain.setGenericPassword(PASSPHRASE_KEY, hash, {
        service: SERVICE_NAME,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      });
      return true;
    } catch (error) {
      logger.error('Failed to set passphrase:', error);
      return false;
    }
  }

  /**
   * Whether the passphrase is right. Throws PassphraseCheckUnavailable when the keychain cannot be read:
   * that is not a wrong passphrase, so it must not count toward a lockout.
   */
  async verifyPassphrase(passphrase: string): Promise<boolean> {
    let credentials: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
    try {
      credentials = await Keychain.getGenericPassword({ service: SERVICE_NAME });
    } catch (error) {
      logger.error('Failed to verify passphrase:', error);
      throw new PassphraseCheckUnavailable();
    }
    if (!credentials) {
      return false;
    }
    return this.hashPassphrase(passphrase) === credentials.password;
  }

  async hasPassphrase(): Promise<boolean> {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SERVICE_NAME,
      });
      return credentials !== false;
    } catch (error) {
      logger.error('Failed to check passphrase:', error);
      return false;
    }
  }

  async removePassphrase(): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({
        service: SERVICE_NAME,
      });
      return true;
    } catch (error) {
      logger.error('Failed to remove passphrase:', error);
      return false;
    }
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    const isValid = await this.verifyPassphrase(oldPassphrase);
    if (!isValid) {
      return false;
    }
    return this.setPassphrase(newPassphrase);
  }
}

export const authService = new AuthService();

/** The keychain could not be read, so the passphrase could not be checked (not a wrong passphrase). */
export class PassphraseCheckUnavailable extends Error {
  constructor() {
    super("Couldn't check your passphrase. Try again.");
    this.name = 'PassphraseCheckUnavailable';
  }
}
