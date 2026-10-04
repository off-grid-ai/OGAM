import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {
  MobileSharedFileStore,
  type MobileSharedFileRecord,
} from '../../../pro/sync/sharedFileStore';

const STORAGE_KEY = 'offgrid-sync-shared-files-v1';

/**
 * The phone's record of the files the mesh has put on it.
 *
 * Every file the user can open from Off Grid is here: this is what the Files list is drawn from, and what tells
 * the app where the bytes are. Two things make it interesting.
 *
 * The paths move. iOS gives an app a new container directory on some updates and restores, so a path saved last
 * week points nowhere today - and a record whose path is stale is a row that opens onto nothing. So the paths
 * are re-based on load, and the re-based version is written back.
 *
 * And it is untrusted input: it survives upgrades and can be restored from a backup, so a record is only kept
 * if the SHARED descriptor parser accepts it - the same parser the receiving path uses.
 */
describe('the phone s record of files the mesh put on it', () => {
  const SYNC_ID = '2f6a1b3c-4d5e-4a70-8b91-c2d3e4f5a6b7';

  const record = (
    overrides: Partial<MobileSharedFileRecord> = {},
  ): MobileSharedFileRecord =>
    ({
      syncId: SYNC_ID,
      kind: 'file',
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
      createdAt: '2026-08-04T09:00:00.000Z',
      localPath: `${RNFS.DocumentDirectoryPath}/shared_files/contract.pdf`,
      ...overrides,
    } as MobileSharedFileRecord);

  const plant = (records: unknown): Promise<void> =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));

  const stored = async (): Promise<MobileSharedFileRecord[]> =>
    JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]');

  beforeEach(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
  });

  describe('holding a file', () => {
    it('keeps what it was given and hands it back by id', async () => {
      const store = new MobileSharedFileStore();

      await store.put(record());

      expect(store.get(SYNC_ID)).toEqual(record());
      expect(store.list()).toEqual([record()]);
    });

    it('knows nothing about a file it has never held', () => {
      expect(new MobileSharedFileStore().get('never-seen')).toBeUndefined();
    });

    it('replaces a file rather than holding it twice', async () => {
      const store = new MobileSharedFileStore();
      await store.put(record());

      await store.put(record({ name: 'contract-v2.pdf' }));

      // One row per syncId: a re-received file appearing twice in the Files list is the same document shown as
      // two, with no way to tell which is current.
      expect(store.list()).toHaveLength(1);
      expect(store.get(SYNC_ID)?.name).toBe('contract-v2.pdf');
    });

    it('forgets a file that was deleted', async () => {
      const store = new MobileSharedFileStore();
      await store.put(record());

      await store.delete(SYNC_ID);

      expect(store.get(SYNC_ID)).toBeUndefined();
      expect(await stored()).toEqual([]);
    });

    it('is happy deleting a file it does not have', async () => {
      const store = new MobileSharedFileStore();

      await expect(store.delete('never-seen')).resolves.toBeUndefined();
    });

    it('writes every change to disk, so a relaunch sees it', async () => {
      const store = new MobileSharedFileStore();

      await store.put(record());

      // Read back through storage: a record that lived only in memory would vanish on the next launch and take
      // the user's file list with it.
      expect(await stored()).toEqual([record()]);
    });

    it('keeps the order it accepted files in', async () => {
      const store = new MobileSharedFileStore();
      await store.put(record({ syncId: SYNC_ID, name: 'first.pdf' }));
      await store.put(
        record({
          syncId: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
          name: 'second.pdf',
        }),
      );

      expect(store.list().map(({ name }) => name)).toEqual([
        'first.pdf',
        'second.pdf',
      ]);
    });

    it('carries on writing after a write that failed', async () => {
      const store = new MobileSharedFileStore();
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('the disk is full'));

      await expect(store.put(record())).rejects.toThrow('the disk is full');
      jest.restoreAllMocks();
      await store.put(record({ name: 'contract-v2.pdf' }));

      // The write queue is serial, so one failure must not poison it - otherwise a single full-disk moment
      // silently stops every later file from being recorded.
      expect(await stored()).toEqual([record({ name: 'contract-v2.pdf' })]);
    });
  });

  describe('reading it back after a relaunch', () => {
    it('has nothing to read on a fresh install', async () => {
      const store = new MobileSharedFileStore();

      await store.load();

      expect(store.list()).toEqual([]);
    });

    it('reads back a file it recorded before', async () => {
      await plant([record()]);
      const store = new MobileSharedFileStore();

      await store.load();

      expect(store.get(SYNC_ID)).toEqual(record());
    });

    it('re-bases a path from a container iOS has since replaced', async () => {
      await plant([
        record({
          localPath:
            '/var/mobile/Containers/Data/Application/OLD-CONTAINER-UUID/Documents/shared_files/contract.pdf',
        }),
      ]);
      const store = new MobileSharedFileStore();

      await store.load();

      // iOS hands the app a new container on some updates and restores. Keeping the old absolute path is a row
      // that opens onto nothing, for a file that is still sitting on the phone.
      expect(store.get(SYNC_ID)?.localPath).toBe(
        `${RNFS.DocumentDirectoryPath}/shared_files/contract.pdf`,
      );
    });

    it('re-bases a cached file too', async () => {
      await plant([
        record({
          localPath:
            '/var/mobile/Containers/Data/Application/OLD/Library/Caches/previews/contract.png',
        }),
      ]);
      const store = new MobileSharedFileStore();

      await store.load();

      expect(store.get(SYNC_ID)?.localPath).toBe(
        `${RNFS.CachesDirectoryPath}/previews/contract.png`,
      );
    });

    it('writes the re-based paths back, so the work is done once', async () => {
      await plant([
        record({
          localPath:
            '/var/mobile/Containers/Data/Application/OLD/Documents/shared_files/contract.pdf',
        }),
      ]);

      await new MobileSharedFileStore().load();

      // Persisted during load: without this every launch re-derives the same paths, and any code reading the
      // raw storage still sees the dead one.
      expect((await stored())[0]?.localPath).toBe(
        `${RNFS.DocumentDirectoryPath}/shared_files/contract.pdf`,
      );
    });

    it('leaves a path that needs no re-basing alone', async () => {
      const setItem = jest.spyOn(AsyncStorage, 'setItem');
      await plant([record()]);
      setItem.mockClear();

      await new MobileSharedFileStore().load();

      // No write at all when nothing moved: loading is on the startup path, and an unnecessary write of every
      // file record is startup cost for nothing.
      expect(setItem).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it('keeps the device a file came from', async () => {
      const provenance = {
        originDeviceId: 'the-mac',
        originDeviceName: "Mac's MacBook Pro",
      };
      await plant([record({ provenance })]);
      const store = new MobileSharedFileStore();

      await store.load();

      // Attribution is the only copy of "where did this come from", and the file itself carries none.
      expect(store.get(SYNC_ID)?.provenance).toEqual(provenance);
    });

    it.each([
      ['no id', { syncId: undefined }],
      ['an id that is not a real one', { syncId: 'not-a-uuid' }],
      ['no path', { localPath: undefined }],
      ['a blank path', { localPath: '' }],
      ['a path that is not text', { localPath: 7 }],
      ['a name the parser refuses', { name: '../escaped.pdf' }],
      ['no name', { name: undefined }],
      ['a size that is not a number', { fileSize: 'big' }],
      ['no type', { mimeType: undefined }],
      ['a kind this build does not know', { kind: 'something-new' }],
      [
        'provenance that is not provenance',
        { provenance: { originDeviceId: 7 } },
      ],
    ])(
      'drops a record with %s, and keeps the good ones',
      async (_label, broken) => {
        const good = record({
          syncId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
          name: 'keep-me.pdf',
        });
        await plant([{ ...record(), ...broken }, good]);
        const store = new MobileSharedFileStore();

        await store.load();

        // Per record, not all-or-nothing: this list is the user's files, and one bad row from an older build must
        // not cost them the rest. The rule is the SHARED parser's, so the phone keeps exactly what the mesh
        // considers a valid file.
        expect(store.list()).toEqual([good]);
      },
    );

    it('starts empty when what is stored is not a list at all', async () => {
      await plant({ files: [] });
      const store = new MobileSharedFileStore();

      await store.load();

      expect(store.list()).toEqual([]);
    });

    it('starts empty when what is stored is not readable', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '[{ truncated');
      const store = new MobileSharedFileStore();

      await store.load();

      // Empty rather than a throw: the Files screen shows nothing instead of the app failing to start, and the
      // next received file repopulates it.
      expect(store.list()).toEqual([]);
    });
  });
});
