import {
  LocalLicenseState,
  type LocalLicenseRecord,
} from '../../pro/licensing/localLicenseState';

interface License extends LocalLicenseRecord {
  maxMachines: number | null;
}

const activeLicense = (expiry: string | null): License => ({
  isPro: true,
  key: 'key',
  entitlementId: 'license',
  expiry,
  maxMachines: 7,
  tier: expiry ? 'subscription' : 'lifetime',
  verifiedAt: 1,
});

describe('LocalLicenseState public behavior', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('isolates a failed observer and still notifies later observers', () => {
    const reported: unknown[] = [];
    const delivered: boolean[] = [];
    const license = activeLicense(null);
    const state = new LocalLicenseState<License>({
      read: async () => license,
      write: async () => undefined,
      publishStore: () => undefined,
      onError: error => reported.push(error),
    });
    const observerFailure = new Error('observer failed');
    state.onChanged(() => {
      throw observerFailure;
    });
    state.onChanged(info => delivered.push(info.isPro));

    expect(state.publish(license).isPro).toBe(true);
    expect(reported).toEqual([observerFailure]);
    expect(delivered).toEqual([true]);
  });

  it('reports a failed store projection and still notifies observers', () => {
    const projectionFailure = new Error('projection failed');
    const reported: unknown[] = [];
    const delivered: boolean[] = [];
    const license = activeLicense(null);
    const state = new LocalLicenseState<License>({
      read: async () => license,
      write: async () => undefined,
      publishStore: () => {
        throw projectionFailure;
      },
      onError: error => reported.push(error),
    });
    state.onChanged(info => delivered.push(info.isPro));

    expect(state.publish(license).isPro).toBe(true);
    expect(reported).toEqual([projectionFailure]);
    expect(delivered).toEqual([true]);
  });

  it('closes access at the local deadline even when persistence fails', async () => {
    jest.useFakeTimers();
    const expiry = new Date(Date.now() + 1_000).toISOString();
    const license = activeLicense(expiry);
    const published: boolean[] = [];
    const persistenceFailure = new Error('storage unavailable');
    const reported: unknown[] = [];
    const state = new LocalLicenseState<License>({
      read: async () => license,
      write: async () => {
        throw persistenceFailure;
      },
      publishStore: info => published.push(info.isPro),
      onError: error => reported.push(error),
    });

    state.schedule(license);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(published).toEqual([false]);
    expect(reported).toEqual([persistenceFailure]);
  });
});
