import { loadProFeatures } from '../../../src/bootstrap/loadProFeatures';

jest.mock('../../../src/services/tools/extensions', () => ({
  registerToolExtension: jest.fn(),
}));
jest.mock('../../../src/navigation/screenRegistry', () => ({
  registerScreen: jest.fn(),
}));
jest.mock('../../../src/components/settings/sectionRegistry', () => ({
  registerSettingsSection: jest.fn(),
}));

const mockReadProFromKeychain = jest.fn();
jest.mock('../../../src/services/proLicenseService', () => ({
  readProFromKeychain: (...args: any[]) => mockReadProFromKeychain(...args),
}));

describe('loadProFeatures()', () => {
  let originalDev: any;
  beforeEach(() => {
    jest.resetModules();
    mockReadProFromKeychain.mockResolvedValue(false);
    // Exercise the production gating (DEV_UNLOCK_PRO = __DEV__ would otherwise
    // force activation in the jest environment where __DEV__ is true).
    originalDev = (global as any).__DEV__;
    (global as any).__DEV__ = false;
  });
  afterEach(() => {
    (global as any).__DEV__ = originalDev;
  });

  it('returns without error when @offgrid/pro package is not installed', async () => {
    jest.mock('@offgrid/pro', () => { throw new Error('Cannot find module'); }, { virtual: true });
    await expect(loadProFeatures()).resolves.toBeUndefined();
  });

  it('returns without error when @offgrid/pro resolves to null (stub build)', async () => {
    jest.mock('@offgrid/pro', () => null, { virtual: true });
    await expect(loadProFeatures()).resolves.toBeUndefined();
  });

  it('does not call pro.activate when there is no entitlement', async () => {
    const mockActivate = jest.fn();
    jest.mock('@offgrid/pro', () => ({ activate: mockActivate }), { virtual: true });
    mockReadProFromKeychain.mockResolvedValueOnce(false);
    await loadProFeatures();
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('calls pro.activate with the three registries when entitlement is active', async () => {
    const mockActivate = jest.fn();
    jest.mock('@offgrid/pro', () => ({ activate: mockActivate }), { virtual: true });
    mockReadProFromKeychain.mockResolvedValueOnce(true);
    await loadProFeatures();
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerToolExtension: expect.any(Function),
        registerScreen: expect.any(Function),
        registerSettingsSection: expect.any(Function),
      }),
    );
  });

  it('reuses a passed isPro=true without re-reading the keychain', async () => {
    const mockActivate = jest.fn();
    jest.mock('@offgrid/pro', () => ({ activate: mockActivate }), { virtual: true });
    await loadProFeatures(true);
    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockReadProFromKeychain).not.toHaveBeenCalled();
  });

  it('reuses a passed isPro=false without re-reading the keychain', async () => {
    const mockActivate = jest.fn();
    jest.mock('@offgrid/pro', () => ({ activate: mockActivate }), { virtual: true });
    await loadProFeatures(false);
    expect(mockActivate).not.toHaveBeenCalled();
    expect(mockReadProFromKeychain).not.toHaveBeenCalled();
  });
});
