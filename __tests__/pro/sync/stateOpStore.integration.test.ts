import { installRealSqlite } from '../../harness/sqliteFake';

/** Uses the real Pro store and shared sync store with only the native SQLite binding replaced. */
describe('Pro state op store startup', () => {
  it('keeps the complete operation log across restart', async () => {
    installRealSqlite();

    const { StateOpStore } = require('../../../pro/sync/stateOpStore');
    const { countOps } = require('@offgrid/sync');
    const { opStoreDriver } = require('../../../pro/sync/opStoreDriver');
    const store = new StateOpStore();

    await store.load();
    store.append({
      opId: 'old-task',
      entity: 'task',
      entityId: 'task-1',
      kind: 'put',
      fields: { text: 'old '.repeat(100_000) },
      lamport: 1,
      deviceId: 'phone',
      ts: 1,
    });
    store.append({
      opId: 'current-task',
      entity: 'task',
      entityId: 'task-1',
      kind: 'put',
      fields: { text: 'current' },
      lamport: 2,
      deviceId: 'phone',
      ts: 2,
    });
    expect(countOps(opStoreDriver)).toBe(2);

    const loaded = await new StateOpStore().load();

    expect(loaded.map((op: { opId: string }) => op.opId)).toEqual([
      'old-task',
      'current-task',
    ]);
    expect(countOps(opStoreDriver)).toBe(2);
  });

  it('keeps receive watermarks across restart', async () => {
    installRealSqlite();

    const { StateOpStore } = require('../../../pro/sync/stateOpStore');
    const store = new StateOpStore();
    await store.load();
    store.append({
      opId: 'phone-old-value',
      entity: 'shared_file',
      entityId: 'file-1',
      kind: 'put',
      fields: { name: 'old.png' },
      lamport: 40,
      deviceId: 'phone',
      ts: 1,
    });
    store.append({
      opId: 'desktop-current-value',
      entity: 'shared_file',
      entityId: 'file-1',
      kind: 'put',
      fields: { name: 'current.png' },
      lamport: 41,
      deviceId: 'desktop',
      ts: 2,
    });

    const restarted = new StateOpStore();
    await restarted.load();

    expect(restarted.entityVersionVector()).toEqual({
      shared_file: { phone: 40, desktop: 41 },
    });
  });
});
