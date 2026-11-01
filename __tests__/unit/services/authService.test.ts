/**
 * AuthService Unit Tests
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

import { authService, PassphraseCheckUnavailable } from '../../../src/services/authService';
import * as Keychain from 'react-native-keychain';

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // setPassphrase
  // ========================================================================
  describe('setPassphrase', () => {
    it('stores hashed passphrase in keychain and returns true', async () => {
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.setPassphrase('mySecret123');

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

      const result = await authService.setPassphrase('mySecret123');

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

      await authService.setPassphrase('correctPassphrase');

      // Mock getGenericPassword to return the stored hash
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.verifyPassphrase('correctPassphrase');

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

      await authService.setPassphrase('correctPassphrase');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.verifyPassphrase('wrongPassphrase');

      expect(result).toBe(false);
    });

    it('returns false when no credentials are stored', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await authService.verifyPassphrase('anyPassphrase');

      expect(result).toBe(false);
    });

    it('says it could not check, not "wrong", when keychain retrieval fails', async () => {
      // A keychain that cannot be read is not a wrong passphrase: answering false charged the person an
      // attempt toward the lockout for typing the right one.
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      await expect(authService.verifyPassphrase('anyPassphrase')).rejects.toBeInstanceOf(PassphraseCheckUnavailable);
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

      const result = await authService.hasPassphrase();

      expect(result).toBe(true);
      expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
    });

    it('returns false when no credentials exist', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await authService.hasPassphrase();

      expect(result).toBe(false);
    });

    it('returns false when keychain check fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await authService.hasPassphrase();

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // removePassphrase
  // ========================================================================
  describe('removePassphrase', () => {
    it('resets keychain credentials and returns true', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.removePassphrase();

      expect(result).toBe(true);
      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
        service: 'ai.offgridmobile.auth',
      });
    });

    it('returns false when keychain reset fails', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const result = await authService.removePassphrase();

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

      await authService.setPassphrase('oldPass');

      // Mock getGenericPassword to return the stored hash for verification
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.changePassphrase('oldPass', 'newPass');

      expect(result).toBe(true);
      // setGenericPassword called twice: once for initial set, once for change
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
    });

    it('returns false when old passphrase is incorrect', async () => {
      let storedHash = '';
      (Keychain.setGenericPassword as jest.Mock).mockImplementation(
        (_key: string, hash: string) => {
          storedHash = hash;
          return Promise.resolve(true);
        },
      );

      await authService.setPassphrase('oldPass');

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        username: 'passphrase_hash',
        password: storedHash,
        service: 'ai.offgridmobile.auth',
      });

      const result = await authService.changePassphrase(
        'wrongOldPass',
        'newPass',
      );

      expect(result).toBe(false);
      // setGenericPassword called only once for the initial set, not for change
      expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    });
  });
});
