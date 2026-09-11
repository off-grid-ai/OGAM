import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RECEIVE_POLICY, type ReceivePolicy } from '@offgrid/sync';
import { ReceivePreferencesStore } from '../../../pro/sync/receivePreferences';

const STORAGE_KEY = 'offgrid-receive-policy-v1';

/**
 * This phone's standing answer to "what will you accept, and from whom".
 *
 * It is the other half of the privacy story: sharing settings decide what leaves a device, this decides what
 * lands on it. Nothing here owns a RULE - precedence, which category an entity belongs to, what an unknown
 * category means all live in the shared package so the Mac answers identically. What it owns is persistence
 * and the toggle, and that is where the failures matter: a toggle that appears to stick but did not would have
 * someone believing they had stopped accepting something they are still accepting.
 */
describe('what this phone will accept, and from whom', () => {
  const store = (): ReceivePreferencesStore => new ReceivePreferencesStore();

  beforeEach(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    jest.restoreAllMocks();
  });

  describe('what it starts as', () => {
    it('accepts everything on a device that has never been told otherwise', async () => {
      const receiving = store();

      const policy = await receiving.load();

      // Accepting by default is what makes a fresh pair work at all; refusing by default would look like a
      // broken mesh on the very first transfer.
      expect(policy).toEqual(DEFAULT_RECEIVE_POLICY);
      expect(receiving.accepts('the-mac', 'files')).toBe(true);
    });

    it('reads back the answer it was given before', async () => {
      const first = store();
      await first.load();
      await first.setCategory('files', false);

      const next = store();
      await next.load();

      // The setting has to survive the app closing, or every launch quietly starts accepting things the user
      // turned off.
      expect(next.accepts('the-mac', 'files')).toBe(false);
      expect(next.accepts('the-mac', 'models')).toBe(true);
    });

    it('falls back to accepting everything when what is stored is not readable', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '{ truncated by a crash');

      const receiving = store();
      const policy = await receiving.load();

      // A corrupt setting file must not take the mesh down, and it must not silently become "refuse
      // everything" either - that reads as the pairing being broken.
      expect(policy).toEqual(DEFAULT_RECEIVE_POLICY);
    });

    it('repairs a stored policy that is missing pieces', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ enabled: true }),
      );

      const policy = await store().load();

      // Written by an older build. Normalised through the shared owner rather than trusted as-is, so a field
      // added since then has a value rather than being undefined at the point a decision is made.
      expect(policy.devices).toEqual({});
      expect(Array.isArray(policy.disabledCategories)).toBe(true);
    });
  });

  describe('the master switch', () => {
    it('refuses optional content but keeps direct model transfers available', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setOptionalEnabled(false);

      // Models are a direct action between paired devices. They have no second receive switch.
      for (const category of ['files', 'clipboard']) {
        expect(receiving.accepts('the-mac', category)).toBe(false);
        expect(receiving.accepts('the-ipad', category)).toBe(false);
      }
      expect(receiving.accepts('the-mac', 'models')).toBe(true);
      expect(receiving.accepts('the-mac', 'chats')).toBe(true);
      expect(receiving.accepts('the-mac', 'projects')).toBe(true);
    });

    it('accepts again when it is switched back on', async () => {
      const receiving = store();
      await receiving.load();
      await receiving.setOptionalEnabled(false);

      await receiving.setOptionalEnabled(true);

      expect(receiving.accepts('the-mac', 'files')).toBe(true);
    });
  });

  describe('turning one kind off', () => {
    it('refuses that kind from every device and keeps the rest', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setCategory('files', false);

      expect(receiving.accepts('the-mac', 'files')).toBe(false);
      expect(receiving.accepts('the-ipad', 'files')).toBe(false);
      expect(receiving.accepts('the-mac', 'models')).toBe(true);
    });

    it('decides an op-log entity by the category it belongs to', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setCategory('chats', false);

      // The mapping from entity to category is the shared package's, asked here rather than restated: a second
      // copy of it would let the phone refuse what the Mac accepts.
      expect(receiving.acceptsEntity('the-mac', 'message')).toBe(true);
      expect(receiving.acceptsEntity('the-mac', 'conversation')).toBe(true);
    });

    it('decides an arriving file by the kind it declares', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setCategory('files', false);

      expect(receiving.acceptsSharedFileKind('the-mac', 'file')).toBe(false);
    });

    it('treats a file kind it does not recognise as an ordinary file', async () => {
      const receiving = store();
      await receiving.load();
      expect(receiving.acceptsSharedFileKind('the-mac', 'something-new')).toBe(
        true,
      );

      await receiving.setCategory('files', false);

      // A kind from a newer build falls under files, so the user's decision about files still governs it -
      // rather than arriving under no rule at all.
      expect(receiving.acceptsSharedFileKind('the-mac', 'something-new')).toBe(
        false,
      );
      expect(receiving.acceptsSharedFileKind('the-mac', undefined)).toBe(false);
    });
  });

  describe('refusing one device', () => {
    it('refuses its optional content but keeps direct model transfers available', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setDeviceOptionalEnabled('the-work-mac', false);

      expect(receiving.accepts('the-work-mac', 'files')).toBe(false);
      expect(receiving.accepts('the-work-mac', 'models')).toBe(true);
      expect(receiving.accepts('the-work-mac', 'chats')).toBe(true);
      // A device the user distrusts is a per-device decision; the rest of their mesh is unaffected.
      expect(receiving.accepts('the-mac', 'files')).toBe(true);
    });

    it('refuses one kind from one device only', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setDeviceCategory('the-work-mac', 'files', false);

      expect(receiving.accepts('the-work-mac', 'files')).toBe(false);
      expect(receiving.accepts('the-work-mac', 'models')).toBe(true);
      expect(receiving.accepts('the-mac', 'chats')).toBe(true);
    });

    it('forgets a device s rules when it leaves the mesh', async () => {
      const receiving = store();
      await receiving.load();
      await receiving.setDeviceOptionalEnabled('the-work-mac', false);

      await receiving.forgetDevice('the-work-mac');

      // Re-pairing is a fresh decision: inheriting an old refusal would make a newly paired device look broken
      // for a reason nothing on screen explains.
      expect(receiving.accepts('the-work-mac', 'files')).toBe(true);
    });

    it('does nothing when the device it is asked to forget has no rules', async () => {
      const receiving = store();
      await receiving.load();
      const before = receiving.get();

      await receiving.forgetDevice('never-paired');

      // Identity, not equality: an unnecessary write would notify every listener and re-render the screen for
      // nothing on every unpair.
      expect(receiving.get()).toBe(before);
    });
  });

  describe('telling the screens', () => {
    it('gives a new subscriber the current answer immediately', async () => {
      const receiving = store();
      await receiving.load();
      await receiving.setCategory('files', false);
      const seen: ReceivePolicy[] = [];

      receiving.subscribe(policy => seen.push(policy));

      // The settings screen draws from the first call: without it every toggle would render as its default
      // until something else changed.
      expect(seen).toHaveLength(1);
      expect(seen[0].disabledCategories).toContain('files');
    });

    it('tells subscribers about every change', async () => {
      const receiving = store();
      await receiving.load();
      const seen: ReceivePolicy[] = [];
      receiving.subscribe(policy => seen.push(policy));

      await receiving.setOptionalEnabled(false);
      await receiving.setOptionalEnabled(true);

      expect(seen.map(({ optionalEnabled }) => optionalEnabled)).toEqual([
        true,
        false,
        true,
      ]);
    });

    it('stops telling a subscriber that unsubscribed', async () => {
      const receiving = store();
      await receiving.load();
      const seen: ReceivePolicy[] = [];
      const unsubscribe = receiving.subscribe(policy => seen.push(policy));

      unsubscribe();
      await receiving.setOptionalEnabled(false);

      // A screen that has gone away must not be re-rendered, and on this store that would mean holding it in
      // memory for the life of the app.
      expect(seen).toHaveLength(1);
    });
  });

  describe('when the setting cannot be written', () => {
    it('reverts the toggle so the user sees what is true', async () => {
      const receiving = store();
      await receiving.load();
      const seen: boolean[] = [];
      receiving.subscribe(({ optionalEnabled }) => seen.push(optionalEnabled));
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('the disk is full'));

      await expect(receiving.setOptionalEnabled(false)).rejects.toThrow(
        'the disk is full',
      );

      // Optimistic and then reverted, visibly: a toggle that stayed off while still accepting everything is
      // the worst outcome available here - the user believes they refused something they did not.
      expect(receiving.get().optionalEnabled).toBe(true);
      expect(seen).toEqual([true, false, true]);
    });

    it('keeps the newer decision when an older write fails behind it', async () => {
      const receiving = store();
      await receiving.load();
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('the disk is full'));

      const failing = receiving
        .setOptionalEnabled(false)
        .catch(() => undefined);
      await receiving.setCategory('files', false);
      await failing;

      // The user turned receiving off, it failed, and they then turned chats off. The failure must not roll
      // back the decision that came after it.
      expect(receiving.get().disabledCategories).toContain('files');
    });

    it('writes what it was asked to write', async () => {
      const receiving = store();
      await receiving.load();

      await receiving.setDeviceCategory('the-work-mac', 'files', false);

      // Read back through storage: the next launch reads exactly these bytes, so a policy that lived only in
      // memory would look like the setting never took.
      const stored = JSON.parse(
        (await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null',
      );
      expect(stored.devices['the-work-mac'].disabledCategories).toContain(
        'files',
      );
    });
  });
});
