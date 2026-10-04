/**
 * Phone passphrase store unit tests
 *
 * Tests for passphrase management: set, verify, check, remove, and change.
 * Uses react-native-keychain for secure storage (mocked in jest.setup.ts).
 */

// Override the global keychain mock to include ACCESSIBLE constant
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
    AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
    ALWAYS: 'AccessibleAlways',
  },
}));

import { mobileSecurityCredentialPort as credentials } from '../../../src/services/adapters/security/mobileSecurityCredentialPort';
import {
  createSecurityFacade,
  EMPTY_SECURITY_STATE,
  type PersistedSecurityState,
} from '@offgrid/application';

/** The lock facts, kept in memory. The passphrase itself still goes through the real keychain. */
function memoryStatePort() {
  let state: PersistedSecurityState | null = EMPTY_SECURITY_STATE;
  return {
    read: async () => state,
    write: async (next: PersistedSecurityState) => {
      state = next;
    },
  };
}
import * as Keychain from 'react-native-keychain';

describe('mobileSecurityCredentialPort', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // setPassphrase
  // ========================================================================
  describe('setPassphrase', () => {
    it('stores hashed passphrase in keychain and returns true', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await credentials.setCredential('mySecret123');

      expect(result).toBe(true);
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'passphrase_hash',
        expect.any(String),
        expect.objectContaining({
          service: 'ai.offgridmobile.auth',
        }),
      );
    });

    it('returns false when keychain storage fails', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain unavailable'),
      );

      const result = await credentials.setCredential('mySecret123');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // verifyPassphrase
  // ========================================================================
  describe('verifyPassphrase', () => {
    it('returns true when passphrase matches stored hash', async () => {
      // First, capture the hash that setPassphrase stores
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await credentials.setCredential('correctPassphrase');

      // Mock getGenericPassword to return the stored hash
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await credentials.verifyCredential('correctPassphrase');

      expect(result).toBe(true);
    });

    it('returns false when passphrase does not match stored hash', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await credentials.setCredential('correctPassphrase');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await credentials.verifyCredential('wrongPassphrase');

      expect(result).toBe(false);
    });

    it('returns false when no credentials are stored', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await credentials.verifyCredential('anyPassphrase');

      expect(result).toBe(false);
    });

    it('returns false when keychain retrieval fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await credentials.verifyCredential('anyPassphrase');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // hasPassphrase
  // ========================================================================
  describe('hasPassphrase', () => {
    it('returns true when credentials exist in keychain', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: 'somehash',
        service: 'ai.offgridmobile.auth',
      });

      const result = await credentials.hasCredential();

      expect(result).toBe(true);
      expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
    });

    it('returns false when no credentials exist', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await credentials.hasCredential();

      expect(result).toBe(false);
    });

    it('returns false when keychain check fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await credentials.hasCredential();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // removePassphrase
  // ========================================================================
  describe('removePassphrase', () => {
    it('resets keychain credentials and returns true', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await credentials.removeCredential();

      expect(result).toBe(true);
      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
    });

    it('returns false when keychain reset fails', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await credentials.removeCredential();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // changePassphrase
  // ========================================================================
  describe('changePassphrase', () => {
    it('changes passphrase when old passphrase is correct', async () => {
      // Set up initial passphrase
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await credentials.setCredential('oldPass');

      // Mock getGenericPassword to return the stored hash for verification
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const security = createSecurityFacade({ credentials, state: memoryStatePort() });
      await security.start();
      await security.enable({ passphrase: 'oldPass', confirmation: 'oldPass' });
      const result = await security.change({
        currentPassphrase: 'oldPass',
        passphrase: 'newPass',
        confirmation: 'newPass',
      });

      expect(result.ok).toBe(true);
      // Three writes: the direct set, the owner's enable, and the change itself.
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(3);
    });

    it('returns false when old passphrase is incorrect', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await credentials.setCredential('oldPass');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const security = createSecurityFacade({ credentials, state: memoryStatePort() });
      await security.start();
      await security.enable({ passphrase: 'oldPass', confirmation: 'oldPass' });
      const result = await security.change({
        currentPassphrase: 'wrongOldPass',
        passphrase: 'newPass',
        confirmation: 'newPass',
      });

      expect(result.ok).toBe(false);
      // Two writes: the direct set and the owner's enable. A refused change writes nothing.
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
    });
  });
});
