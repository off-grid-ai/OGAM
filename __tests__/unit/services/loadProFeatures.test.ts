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

describe('loadProFeatures()', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns without error when @offgrid/pro package is not installed', async () => {
    jest.mock('@offgrid/pro', () => { throw new Error('Cannot find module'); }, { virtual: true });
    await expect(loadProFeatures()).resolves.toBeUndefined();
  });

  it('returns without error when @offgrid/pro resolves to null (stub build)', async () => {
    jest.mock('@offgrid/pro', () => null, { virtual: true });
    await expect(loadProFeatures()).resolves.toBeUndefined();
  });

  it('calls pro.activate with the three registries when package is present', async () => {
    const mockActivate = jest.fn();
    jest.mock('@offgrid/pro', () => ({ activate: mockActivate }), { virtual: true });
    await loadProFeatures();
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerToolExtension: expect.any(Function),
        registerScreen: expect.any(Function),
        registerSettingsSection: expect.any(Function),
      }),
    );
  });
});
