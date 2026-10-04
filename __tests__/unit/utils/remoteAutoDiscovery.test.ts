import {
  shouldAutoDiscoverRemoteModels,
  resolveAutoDiscoverMigration,
} from '@offgrid/models';

describe('shouldAutoDiscoverRemoteModels — auto LAN scan runs only when explicitly ON', () => {
  it('OFF when unset (fresh install)', () => {
    expect(shouldAutoDiscoverRemoteModels({})).toBe(false);
    expect(shouldAutoDiscoverRemoteModels({ autoDiscoverRemoteModels: undefined })).toBe(false);
  });
  it('OFF when explicitly false', () => {
    expect(shouldAutoDiscoverRemoteModels({ autoDiscoverRemoteModels: false })).toBe(false);
  });
  it('ON only when explicitly true', () => {
    expect(shouldAutoDiscoverRemoteModels({ autoDiscoverRemoteModels: true })).toBe(true);
  });
});

describe('resolveAutoDiscoverMigration — one-time default (grandfather existing gateway users)', () => {
  it('fresh install (unset, no gateway) → OFF', () => {
    expect(resolveAutoDiscoverMigration(undefined, false)).toBe(false);
  });
  it('upgrading user with a gateway already added (unset) → ON', () => {
    expect(resolveAutoDiscoverMigration(undefined, true)).toBe(true);
  });
  it('already decided → no change (undefined), regardless of gateways', () => {
    expect(resolveAutoDiscoverMigration(true, false)).toBeUndefined();
    expect(resolveAutoDiscoverMigration(false, true)).toBeUndefined();
    expect(resolveAutoDiscoverMigration(true, true)).toBeUndefined();
    expect(resolveAutoDiscoverMigration(false, false)).toBeUndefined();
  });
});
