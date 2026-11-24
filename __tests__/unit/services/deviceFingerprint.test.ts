jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
}));

describe('deviceFingerprint', () => {
  beforeEach(() => {
    jest.resetModules(); // clear the module-level fingerprint cache between cases
  });

  it('reuses the persisted fingerprint when one exists', async () => {
    jest.doMock('react-native-keychain', () => ({
      getGenericPassword: jest.fn(async () => ({
        username: 'fingerprint',
        password: 'existing-fp',
      })),
      setGenericPassword: jest.fn(async () => true),
      ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    }));
    const {
      getDeviceFingerprint,
    } = require('../../../pro/licensing/deviceFingerprint');
    const keychain = require('react-native-keychain');

    expect(await getDeviceFingerprint()).toBe('existing-fp');
    expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('generates and persists a fingerprint when none exists', async () => {
    const setSpy = jest.fn((_username: string, _password: string) =>
      Promise.resolve(true),
    );
    jest.doMock('react-native-keychain', () => ({
      getGenericPassword: jest.fn(async () => false),
      setGenericPassword: setSpy,
      ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    }));
    const {
      getDeviceFingerprint,
    } = require('../../../pro/licensing/deviceFingerprint');

    const fp = await getDeviceFingerprint();
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
    expect(setSpy).toHaveBeenCalledTimes(1);
    // persisted value matches what was returned
    expect(setSpy.mock.calls[0][1]).toBe(fp);
  });

  describe('after an OS update breaks the Keystore key (Android 17)', () => {
    const KEYSTORE_ERROR = 'Wrapped error: Keystore operation failed';

    /** A keychain whose fingerprint entry fails to read and write until it is reset. */
    const brokenKeychain = ({ resetFixes = true } = {}) => {
      const items = new Map<string, string>([
        ['off-grid-device-fingerprint', 'lost-fp'],
      ]);
      let broken = true;
      return {
        items,
        module: {
          getGenericPassword: jest.fn(
            async ({ service }: { service: string }) => {
              if (broken) throw new Error(KEYSTORE_ERROR);
              const password = items.get(service);
              return password ? { username: 'fingerprint', password } : false;
            },
          ),
          setGenericPassword: jest.fn(
            async (
              _user: string,
              password: string,
              { service }: { service: string },
            ) => {
              if (broken) throw new Error(KEYSTORE_ERROR);
              items.set(service, password);
              return { service, storage: 'KeystoreAESGCM_NoAuth' };
            },
          ),
          resetGenericPassword: jest.fn(
            async ({ service }: { service: string }) => {
              if (resetFixes) broken = false;
              return items.delete(service);
            },
          ),
          ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
        },
      };
    };

    it('makes a new fingerprint that the next launch reads back', async () => {
      const keychain = brokenKeychain();
      jest.doMock('react-native-keychain', () => keychain.module);
      const {
        getDeviceFingerprintStrict,
      } = require('../../../pro/licensing/deviceFingerprint');

      const fp = await getDeviceFingerprintStrict();

      expect(fp).not.toBe('lost-fp');
      expect(keychain.items.get('off-grid-device-fingerprint')).toBe(fp);
      jest.resetModules();
      jest.doMock('react-native-keychain', () => keychain.module);
      const relaunched = require('../../../pro/licensing/deviceFingerprint');
      expect(await relaunched.getDeviceFingerprintStrict()).toBe(fp);
    });

    it('the best-effort fingerprint is saved too', async () => {
      const keychain = brokenKeychain();
      jest.doMock('react-native-keychain', () => keychain.module);
      const {
        getDeviceFingerprint,
      } = require('../../../pro/licensing/deviceFingerprint');

      const fp = await getDeviceFingerprint();

      expect(keychain.items.get('off-grid-device-fingerprint')).toBe(fp);
    });

    it('refuses to activate when the keystore still fails after the reset', async () => {
      jest.doMock(
        'react-native-keychain',
        () => brokenKeychain({ resetFixes: false }).module,
      );
      const {
        getDeviceFingerprintStrict,
      } = require('../../../pro/licensing/deviceFingerprint');

      await expect(getDeviceFingerprintStrict()).rejects.toThrow(
        KEYSTORE_ERROR,
      );
    });

    it('leaves a locked keychain alone: only a broken key is reset', async () => {
      const reset = jest.fn(async () => true);
      jest.doMock('react-native-keychain', () => ({
        getGenericPassword: jest.fn(async () => {
          throw new Error('User interaction is not allowed.');
        }),
        setGenericPassword: jest.fn(async () => {
          throw new Error('User interaction is not allowed.');
        }),
        resetGenericPassword: reset,
        ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
      }));
      const {
        getDeviceFingerprintStrict,
      } = require('../../../pro/licensing/deviceFingerprint');

      await expect(getDeviceFingerprintStrict()).rejects.toThrow(
        'User interaction is not allowed.',
      );
      expect(reset).not.toHaveBeenCalled();
    });
  });

  it('reads a Keystore failure from a non-Error value too', () => {
    const {
      isKeystoreFailure,
    } = require('../../../pro/licensing/keystoreRecovery');
    expect(isKeystoreFailure('KeyPermanentlyInvalidatedException')).toBe(true);
    expect(isKeystoreFailure(undefined)).toBe(false);
  });

  it('maps the platform tag', () => {
    const rn = require('react-native');
    rn.Platform.OS = 'android';
    const {
      getPlatformTag,
    } = require('../../../pro/licensing/deviceFingerprint');
    expect(getPlatformTag()).toBe('android');
  });
});
