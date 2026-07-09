import {
  readProFromKeychain,
  checkProStatus,
  activateProByKey,
  revalidatePro,
  listProDevices,
  deactivateProDevice,
  clearProForTesting,
} from '../../../src/services/proLicenseService';

jest.mock('../../../src/services/keygenClient', () => ({
  validateKey: jest.fn(),
  activateMachine: jest.fn(),
  listMachines: jest.fn(),
  deactivateMachine: jest.fn(),
  KeygenNetworkError: class KeygenNetworkError extends Error {},
}));

jest.mock('../../../src/services/deviceFingerprint', () => ({
  getDeviceFingerprint: jest.fn(async () => 'fp-123'),
  getPlatformTag: jest.fn(() => 'ios'),
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
}));

const mockSetHasRegisteredPro = jest.fn();
jest.mock('../../../src/stores/appStore', () => ({
  useAppStore: { getState: () => ({ setHasRegisteredPro: mockSetHasRegisteredPro }) },
}));

const keygen = require('../../../src/services/keygenClient');
const { validateKey, activateMachine, listMachines, deactivateMachine, KeygenNetworkError } = keygen;
const { getGenericPassword, setGenericPassword, resetGenericPassword } = require('react-native-keychain');

const license = (over: Record<string, unknown> = {}) => ({
  password: JSON.stringify({ isPro: true, key: 'key/abc', licenseId: 'lic-1', expiry: null, verifiedAt: 0, ...over }),
});
const ok = (over: Record<string, unknown> = {}) => ({
  valid: true,
  code: 'VALID',
  license: { id: 'lic-1', expiry: null, metadata: {}, name: null },
  ...over,
});

describe('proLicenseService (Keygen)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setGenericPassword.mockResolvedValue(true);
    resetGenericPassword.mockResolvedValue(true);
    validateKey.mockResolvedValue({ valid: false, code: 'UNKNOWN', license: null });
  });

  describe('readProFromKeychain()', () => {
    it('false when no entry', async () => {
      getGenericPassword.mockResolvedValueOnce(false);
      expect(await readProFromKeychain()).toBe(false);
    });
    it('true when cached pro with no expiry (lifetime)', async () => {
      getGenericPassword.mockResolvedValueOnce(license());
      expect(await readProFromKeychain()).toBe(true);
    });
    it('false when a monthly key expiry has passed', async () => {
      getGenericPassword.mockResolvedValueOnce(license({ expiry: '2000-01-01T00:00:00Z' }));
      expect(await readProFromKeychain()).toBe(false);
    });
    it('true when a monthly key expiry is in the future', async () => {
      getGenericPassword.mockResolvedValueOnce(license({ expiry: '2999-01-01T00:00:00Z' }));
      expect(await readProFromKeychain()).toBe(true);
    });
    it('false when malformed', async () => {
      getGenericPassword.mockResolvedValueOnce({ password: 'not-json' });
      expect(await readProFromKeychain()).toBe(false);
    });
  });

  describe('checkProStatus()', () => {
    it('returns the cached value immediately', async () => {
      getGenericPassword.mockResolvedValue(license());
      expect(await checkProStatus()).toBe(true);
    });
  });

  describe('activateProByKey()', () => {
    it('unlocks when the key is already VALID on this device', async () => {
      validateKey.mockResolvedValueOnce(ok());
      const res = await activateProByKey('key/abc');
      expect(res).toEqual({ ok: true });
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
      const written = JSON.parse(setGenericPassword.mock.calls[0][1]);
      expect(written.isPro).toBe(true);
      expect(written.key).toBe('key/abc');
    });

    it('activates a new device when the key is valid but unactivated', async () => {
      validateKey.mockResolvedValueOnce(ok({ valid: false, code: 'NO_MACHINES' }));
      activateMachine.mockResolvedValueOnce({ ok: true, limitReached: false });
      const res = await activateProByKey('key/abc');
      expect(res).toEqual({ ok: true });
      expect(activateMachine).toHaveBeenCalledWith('key/abc', 'lic-1', { fingerprint: 'fp-123', platform: 'ios' });
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('reports limit when activation hits the device cap', async () => {
      validateKey.mockResolvedValueOnce(ok({ valid: false, code: 'NO_MACHINES' }));
      activateMachine.mockResolvedValueOnce({ ok: false, limitReached: true });
      expect(await activateProByKey('key/abc')).toEqual({ ok: false, reason: 'limit' });
    });

    it('reports limit when validate already says TOO_MANY_MACHINES', async () => {
      validateKey.mockResolvedValueOnce({ valid: false, code: 'TOO_MANY_MACHINES', license: { id: 'lic-1', expiry: null, metadata: {}, name: null } });
      expect(await activateProByKey('key/abc')).toEqual({ ok: false, reason: 'limit' });
    });

    it('reports invalid for an unknown / not-found key', async () => {
      validateKey.mockResolvedValueOnce({ valid: false, code: 'NOT_FOUND', license: null });
      expect(await activateProByKey('key/nope')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('reports invalid for an expired key', async () => {
      validateKey.mockResolvedValueOnce({ valid: false, code: 'EXPIRED', license: { id: 'lic-1', expiry: '2000-01-01T00:00:00Z', metadata: {}, name: null } });
      expect(await activateProByKey('key/abc')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('reports network when the request throws', async () => {
      validateKey.mockRejectedValueOnce(new KeygenNetworkError('offline'));
      expect(await activateProByKey('key/abc')).toEqual({ ok: false, reason: 'network' });
    });

    it('reports invalid for an empty key', async () => {
      expect(await activateProByKey('   ')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('strips surrounding whitespace before validating AND persisting the key', async () => {
      // A pasted/emailed key often carries leading/trailing whitespace or a newline.
      // The TRIMMED key must reach validateKey (a padded key would 404) and be the value
      // persisted to the keychain (so revalidation later uses the clean key). The empty
      // test above only covers whitespace-ONLY input; this covers a real key with padding.
      validateKey.mockResolvedValueOnce(ok());
      const res = await activateProByKey('  key/abc\n');
      expect(res).toEqual({ ok: true });
      expect(validateKey).toHaveBeenCalledWith('key/abc', 'fp-123');
      const written = JSON.parse(setGenericPassword.mock.calls[0][1]);
      expect(written.key).toBe('key/abc');
    });

    it('passes the trimmed key to activateMachine on the new-device path', async () => {
      validateKey.mockResolvedValueOnce(ok({ valid: false, code: 'NO_MACHINES' }));
      activateMachine.mockResolvedValueOnce({ ok: true, limitReached: false });
      await activateProByKey('\tkey/abc  ');
      expect(activateMachine).toHaveBeenCalledWith('key/abc', 'lic-1', { fingerprint: 'fp-123', platform: 'ios' });
    });
  });

  describe('revalidatePro() — revocation + offline', () => {
    it('no-ops when there is no cached key', async () => {
      getGenericPassword.mockResolvedValue(false);
      await revalidatePro();
      expect(validateKey).not.toHaveBeenCalled();
      expect(setGenericPassword).not.toHaveBeenCalled();
    });

    it('locks Pro when the key was revoked (SUSPENDED)', async () => {
      getGenericPassword.mockResolvedValue(license());
      validateKey.mockResolvedValueOnce({ valid: false, code: 'SUSPENDED', license: { id: 'lic-1', expiry: null, metadata: {}, name: null } });
      await revalidatePro();
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
      const written = JSON.parse(setGenericPassword.mock.calls[0][1]);
      expect(written.isPro).toBe(false);
    });

    it('keeps cached state when offline (network error)', async () => {
      getGenericPassword.mockResolvedValue(license());
      validateKey.mockRejectedValueOnce(new KeygenNetworkError('offline'));
      await revalidatePro();
      expect(setGenericPassword).not.toHaveBeenCalled();
      expect(mockSetHasRegisteredPro).not.toHaveBeenCalled();
    });

    it('keeps Pro active when still VALID', async () => {
      getGenericPassword.mockResolvedValue(license());
      validateKey.mockResolvedValueOnce(ok());
      await revalidatePro();
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });
  });

  describe('device management', () => {
    it('lists devices for the active license', async () => {
      getGenericPassword.mockResolvedValue(license());
      listMachines.mockResolvedValueOnce([{ id: 'm1', fingerprint: 'fp-123', platform: 'ios', name: null, lastSeen: null }]);
      const devices = await listProDevices();
      expect(devices).toHaveLength(1);
      expect(listMachines).toHaveBeenCalledWith('key/abc', 'lic-1');
    });

    it('deactivates a device', async () => {
      getGenericPassword.mockResolvedValue(license());
      deactivateMachine.mockResolvedValueOnce(true);
      expect(await deactivateProDevice('m1')).toBe(true);
      expect(deactivateMachine).toHaveBeenCalledWith('key/abc', 'm1');
    });
  });

  describe('clearProForTesting()', () => {
    it('resets the keychain and clears the store flag', async () => {
      await clearProForTesting();
      expect(resetGenericPassword).toHaveBeenCalledTimes(1);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
    });
  });
});
