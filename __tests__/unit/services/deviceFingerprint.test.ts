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
      getGenericPassword: jest.fn(async () => ({ username: 'fingerprint', password: 'existing-fp' })),
      setGenericPassword: jest.fn(async () => true),
      ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    }));
    const { getDeviceFingerprint } = require('../../../src/services/deviceFingerprint');
    const keychain = require('react-native-keychain');

    expect(await getDeviceFingerprint()).toBe('existing-fp');
    expect(keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('generates and persists a fingerprint when none exists', async () => {
    const setSpy = jest.fn((_username: string, _password: string) => Promise.resolve(true));
    jest.doMock('react-native-keychain', () => ({
      getGenericPassword: jest.fn(async () => false),
      setGenericPassword: setSpy,
      ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    }));
    const { getDeviceFingerprint } = require('../../../src/services/deviceFingerprint');

    const fp = await getDeviceFingerprint();
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
    expect(setSpy).toHaveBeenCalledTimes(1);
    // persisted value matches what was returned
    expect(setSpy.mock.calls[0][1]).toBe(fp);
  });

  it('maps the platform tag', () => {
    const rn = require('react-native');
    rn.Platform.OS = 'android';
    const { getPlatformTag } = require('../../../src/services/deviceFingerprint');
    expect(getPlatformTag()).toBe('android');
  });
});
