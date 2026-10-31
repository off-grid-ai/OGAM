import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AMBIENT_SHARE_ANY_DESTINATION,
  sharedFileActivityId,
  type AmbientSharePolicy,
} from '@offgrid/sync';
import {
  AmbientShareStateStore,
  ambientDeliveryKey,
  type AmbientApprovalResult,
  type AmbientDelivery,
} from '../../../pro/sync/ambientSharePersistence';
import type { SyncPreferences } from '../../../pro/sync/syncPreferences';

const STORAGE_KEY = 'offgrid-sync-ambient-sharing-v1';

/**
 * What this phone remembers about ambient sharing across launches.
 *
 * Three things live here: the rules the user set, the files still waiting to go, and the approval decisions
 * they already gave. Losing any of them has a visible cost - a rule lost means files start moving that the user
 * turned off, a queue lost means a screenshot taken on a plane never arrives, and an approval lost means being
 * asked twice about the same file.
 *
 * So this is a parser as much as a store: everything read back is untrusted (it survives upgrades and can be
 * restored from a backup), and the safe answer to an unreadable rule is to fall back to the preferences the user
 * already expressed rather than to invent a permissive default.
 */
describe('what the phone remembers about ambient sharing', () => {
  const preferences = (
    overrides: Partial<SyncPreferences> = {},
  ): SyncPreferences => ({
    chats: true,
    projects: true,
    settings: true,
    notes: true,
    screenshots: true,
    downloads: false,
    generatedMedia: false,
    attachments: false,
    ...overrides,
  });

  const policy = (
    mode: 'auto' | 'ask' | 'off' = 'auto',
  ): AmbientSharePolicy => ({
    rules: [
      {
        source: 'screenshot',
        destinationId: AMBIENT_SHARE_ANY_DESTINATION,
        mode,
      },
    ],
    offlineBehavior: 'queue',
  });

  const delivery = (
    overrides: Partial<AmbientDelivery> = {},
  ): AmbientDelivery =>
    ({
      syncId: '6d5c4b3a-2f1e-4a09-8b7c-6d5e4f3a2b1c',
      destinationId: 'the-mac',
      status: 'queued',
      createdAt: 1_700_000_000_000,
      ...overrides,
    } as AmbientDelivery);

  const approvalResult = (
    overrides: Partial<AmbientApprovalResult> = {},
  ): AmbientApprovalResult =>
    ({
      id: 'approval-1',
      accepted: true,
      resolvedAt: 1_700_000_000_000,
      approval: {
        syncId: 'shared-1',
        deviceId: 'the-mac',
        deviceName: 'The Mac',
        kind: 'screenshot',
        name: 'Screenshot 1.png',
        mimeType: 'image/png',
        fileSize: 2048,
      },
      ...overrides,
    } as AmbientApprovalResult);

  const plant = (value: unknown): Promise<void> =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));

  beforeEach(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    jest.restoreAllMocks();
  });

  describe('a device that has never set an ambient rule', () => {
    it('starts from the sharing preferences the user already gave', async () => {
      const loaded = await new AmbientShareStateStore().load(
        preferences({ screenshots: true, downloads: false }),
      );

      // Migrated, not defaulted: someone who had screenshots on and downloads off keeps exactly that when the
      // per-destination rules arrive, rather than being opted into everything or out of everything.
      const modeFor = (source: string): string | undefined =>
        loaded.policy.rules.find(rule => rule.source === source)?.mode;
      expect(modeFor('screenshot')).toBe('auto');
      expect(modeFor('download')).toBe('off');
      // Durable chat media follows its message. It is not an ambient preference or a second switch.
      expect(modeFor('generated_media')).toBeUndefined();
      expect(modeFor('message_attachment')).toBeUndefined();
    });

    it('applies each rule to every device until told otherwise', async () => {
      const loaded = await new AmbientShareStateStore().load(preferences());

      expect(
        loaded.policy.rules.every(
          ({ destinationId }) =>
            destinationId === AMBIENT_SHARE_ANY_DESTINATION,
        ),
      ).toBe(true);
    });

    it('queues for a device that is away, rather than dropping the file', async () => {
      const loaded = await new AmbientShareStateStore().load(preferences());

      // A device that was asleep when the file was made is the normal case, not a reason to drop it.
      // Skipping made the outcome depend on which device happened to be awake, which nobody can
      // predict or check afterwards.
      expect(loaded.policy.offlineBehavior).toBe('queue');
    });

    it('has nothing waiting and nothing already decided', async () => {
      const loaded = await new AmbientShareStateStore().load(preferences());

      expect(loaded.deliveries).toEqual([]);
      expect(loaded.approvalResults).toEqual([]);
    });
  });

  describe('reading back what it saved', () => {
    it('gives back the rules, the queue and the decisions', async () => {
      const store = new AmbientShareStateStore();
      await store.save(policy('ask'), [delivery()], [approvalResult()]);

      const loaded = await new AmbientShareStateStore().load(preferences());

      expect(loaded.policy).toEqual(policy('ask'));
      expect(loaded.deliveries).toEqual([delivery()]);
      expect(loaded.approvalResults).toEqual([approvalResult()]);
    });

    it('keeps a delivery mid-transfer, with its progress', async () => {
      const store = new AmbientShareStateStore();
      const sending = delivery({
        status: 'granted',
        transferStatus: 'sending',
      });
      await store.save(policy(), [sending], []);

      const loaded = await new AmbientShareStateStore().load(preferences());

      // An in-memory send cannot still be live after restart. Clear the transient phase so reconnect retries it.
      expect(loaded.deliveries).toEqual([
        { ...sending, transferStatus: undefined },
      ]);
    });

    it('keeps the reason a delivery failed', async () => {
      const store = new AmbientShareStateStore();
      const failed = delivery({
        status: 'granted',
        transferStatus: 'failed',
        error: 'the other device went away',
      });
      await store.save(policy(), [failed], []);

      const loaded = await new AmbientShareStateStore().load(preferences());

      // The Activity row shows this sentence after a relaunch; losing it leaves a failure with no explanation.
      expect(loaded.deliveries[0]?.error).toBe('the other device went away');
    });

    it('keeps a rule about which document kinds may go', async () => {
      const store = new AmbientShareStateStore();
      const narrowed: AmbientSharePolicy = {
        rules: [
          {
            source: 'download',
            destinationId: 'the-mac',
            mode: 'auto',
            documentKinds: ['pdf', 'pdf'],
          },
        ],
        offlineBehavior: 'skip',
      };

      await store.save(narrowed, [], []);
      const loaded = await new AmbientShareStateStore().load(preferences());

      // De-duplicated on the way back: the same kind twice is the same permission, and a list that grew on every
      // save would eventually be the thing that fails to parse.
      expect(loaded.policy.rules[0]?.documentKinds).toEqual(['pdf']);
    });
  });

  describe('when what is stored cannot be trusted', () => {
    it('falls back to the user s preferences when the rules are unreadable', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '{ truncated by a crash');

      const loaded = await new AmbientShareStateStore().load(
        preferences({ screenshots: true }),
      );

      // Back to what the user expressed, never to "share everything": a corrupt file must not become permission.
      expect(
        loaded.policy.rules.find(rule => rule.source === 'screenshot')?.mode,
      ).toBe('auto');
      expect(loaded.policy.offlineBehavior).toBe('queue');
    });

    it.each([
      ['the rules are missing', { policy: { offlineBehavior: 'skip' } }],
      [
        'the rules are not a list',
        { policy: { rules: {}, offlineBehavior: 'skip' } },
      ],
      [
        'the offline behaviour is not one this build knows',
        { policy: { rules: [], offlineBehavior: 'hoard' } },
      ],
      [
        'a rule names a source this build does not know',
        {
          policy: {
            rules: [
              { source: 'camera_roll', destinationId: '*', mode: 'auto' },
            ],
            offlineBehavior: 'skip',
          },
        },
      ],
      [
        'a rule names a mode this build does not know',
        {
          policy: {
            rules: [
              { source: 'screenshot', destinationId: '*', mode: 'maybe' },
            ],
            offlineBehavior: 'skip',
          },
        },
      ],
      [
        'a rule is a bare string rather than a rule',
        { policy: { rules: ['screenshot'], offlineBehavior: 'skip' } },
      ],
      [
        'a rule has no destination',
        {
          policy: {
            rules: [{ source: 'screenshot', destinationId: '', mode: 'auto' }],
            offlineBehavior: 'skip',
          },
        },
      ],
    ])('falls back when %s', async (_label, stored) => {
      await plant({
        version: 2,
        ...stored,
        deliveries: [],
        approvalResults: [],
      });

      const loaded = await new AmbientShareStateStore().load(
        preferences({ downloads: true }),
      );

      // ALL of it, not the readable half: a policy is a set of rules that only makes sense together, and
      // half-applying it would share a source the user had turned off through a rule that survived.
      expect(
        loaded.policy.rules.find(rule => rule.source === 'download')?.mode,
      ).toBe('auto');
      expect(loaded.policy.rules).toHaveLength(2);
    });

    it('keeps a rule whose document kinds are unreadable, without them', async () => {
      await plant({
        version: 2,
        policy: {
          rules: [
            {
              source: 'download',
              destinationId: 'the-mac',
              mode: 'auto',
              documentKinds: ['pdf', 'holograms'],
            },
          ],
          offlineBehavior: 'skip',
        },
        deliveries: [],
        approvalResults: [],
      });

      const loaded = await new AmbientShareStateStore().load(preferences());

      // The rule itself is still the user's decision; only the narrowing is dropped, and dropping it falls back
      // to the safe documents-and-images default rather than to sharing nothing.
      expect(loaded.policy.rules).toHaveLength(1);
      expect(loaded.policy.rules[0]?.documentKinds).toBeUndefined();
    });

    it.each([
      ['no id', { syncId: undefined }],
      ['no destination', { destinationId: '' }],
      ['a status this build does not know', { status: 'thinking' }],
      ['no time', { createdAt: undefined }],
      ['a time that is not a number', { createdAt: 'yesterday' }],
      [
        'a transfer status this build does not know',
        { transferStatus: 'paused' },
      ],
      ['an error that is not text', { error: 7 }],
      ['nothing at all', undefined],
    ])(
      'drops a queued delivery with %s and keeps the rest',
      async (_label, broken) => {
        await plant({
          version: 2,
          policy: policy(),
          deliveries: [
            typeof broken === 'object' && broken !== null
              ? { ...delivery(), ...broken }
              : broken,
            delivery({ syncId: '7e6d5c4b-3a2f-4b10-9c8d-7e6f5a4b3c2d' }),
          ],
          approvalResults: [],
        });

        const loaded = await new AmbientShareStateStore().load(preferences());

        // Per delivery: one unreadable row from an older build must not empty the queue and silently drop every
        // file waiting to go.
        expect(loaded.deliveries).toEqual([
          delivery({ syncId: '7e6d5c4b-3a2f-4b10-9c8d-7e6f5a4b3c2d' }),
        ]);
      },
    );

    it.each([
      ['no id', { id: '' }],
      ['no answer', { accepted: undefined }],
      ['no time', { resolvedAt: undefined }],
      ['nothing it was about', { approval: undefined }],
      [
        'a file kind this build does not know',
        { approval: { kind: 'camera_roll' } },
      ],
    ])('drops an approval decision with %s', async (_label, broken) => {
      const base = approvalResult();
      const merged =
        'approval' in broken && broken.approval !== undefined
          ? { ...base, approval: { ...base.approval, ...broken.approval } }
          : { ...base, ...broken };
      await plant({
        version: 2,
        policy: policy(),
        deliveries: [],
        approvalResults: [merged, approvalResult({ id: 'approval-2' })],
      });

      const loaded = await new AmbientShareStateStore().load(preferences());

      // A decision that cannot be read is a decision this build cannot honour, so it is forgotten and the user
      // is asked again - which is the safe direction for a permission.
      expect(loaded.approvalResults).toEqual([
        approvalResult({ id: 'approval-2' }),
      ]);
    });

    it.each([
      ['a bare number where the rules belong', { policy: 5 }],
      ['nothing where a delivery belongs', { deliveries: [7] }],
      ['nothing where a decision belongs', { approvalResults: ['approval-1'] }],
    ])('survives %s', async (_label, stored) => {
      await plant({
        version: 2,
        policy: policy(),
        deliveries: [],
        approvalResults: [],
        ...stored,
      });

      const loaded = await new AmbientShareStateStore().load(preferences());

      // Storage can hold anything a backup or an older build put there. Every one of these is a value, not a
      // shape - and none of them may throw on the startup path.
      expect(loaded.deliveries).toEqual([]);
      expect(loaded.approvalResults).toEqual([]);
      expect(loaded.policy.rules.length).toBeGreaterThan(0);
    });

    it('treats a missing queue and missing decisions as empty', async () => {
      await plant({ version: 2, policy: policy() });

      const loaded = await new AmbientShareStateStore().load(preferences());

      expect(loaded.deliveries).toEqual([]);
      expect(loaded.approvalResults).toEqual([]);
      expect(loaded.policy).toEqual(policy());
    });
  });

  describe('writing', () => {
    it('carries on after a write that failed', async () => {
      const store = new AmbientShareStateStore();
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('the disk is full'));

      await expect(store.save(policy(), [], [])).rejects.toThrow(
        'the disk is full',
      );
      jest.restoreAllMocks();
      await store.save(policy('ask'), [delivery()], []);

      // The queue is serial, so one failure must not poison it - otherwise a single full-disk moment silently
      // stops every later rule and delivery from being recorded.
      const loaded = await new AmbientShareStateStore().load(preferences());
      expect(loaded.policy).toEqual(policy('ask'));
      expect(loaded.deliveries).toEqual([delivery()]);
    });

    it('collapses a burst of progress into one write', async () => {
      jest.useFakeTimers();
      const store = new AmbientShareStateStore();
      const setItem = jest.spyOn(AsyncStorage, 'setItem');

      for (let index = 0; index < 20; index += 1) {
        store.saveSoon(policy(), [delivery({ syncId: `shared-${index}` })], []);
      }

      // A device reconnecting with a hundred files waiting used to write the whole set once per file, each
      // write serialising all of them. Nothing is written yet - the burst is still collapsing.
      expect(setItem).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(500);
      expect(setItem).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('writes the FIRST snapshot of a burst, then accepts the next one', async () => {
      jest.useFakeTimers();
      const store = new AmbientShareStateStore();

      store.saveSoon(policy(), [delivery({ syncId: 'first' })], []);
      store.saveSoon(policy(), [delivery({ syncId: 'second' })], []);
      await jest.advanceTimersByTimeAsync(500);

      const afterBurst = await new AmbientShareStateStore().load(preferences());
      expect(afterBurst.deliveries.map(({ syncId }) => syncId)).toEqual([
        'first',
      ]);

      // The next burst is a fresh window, so nothing is stuck: progress after the coalescing window still lands.
      store.saveSoon(policy(), [delivery({ syncId: 'third' })], []);
      await jest.advanceTimersByTimeAsync(500);
      jest.useRealTimers();
      const afterSecond = await new AmbientShareStateStore().load(
        preferences(),
      );
      expect(afterSecond.deliveries.map(({ syncId }) => syncId)).toEqual([
        'third',
      ]);
    });

    it('does not reject when a coalesced write fails', async () => {
      jest.useFakeTimers();
      const store = new AmbientShareStateStore();
      jest
        .spyOn(AsyncStorage, 'setItem')
        .mockRejectedValueOnce(new Error('the disk is full'));

      store.saveSoon(policy(), [delivery()], []);

      // Nobody is awaiting this one - it is re-derivable progress - so a failure must not surface as an
      // unhandled rejection and take the app down.
      await expect(jest.advanceTimersByTimeAsync(500)).resolves.toBeUndefined();
      jest.useRealTimers();
    });
  });

  describe('naming a delivery', () => {
    const FILE_ID = '6d5c4b3a-2f1e-4a09-8b7c-6d5e4f3a2b1c';

    it('names it the way the transfer does', () => {
      // One id for one file going to one device, derived by the shared helper: the Activity row, the transfer
      // and this queue all have to agree on it, and a second definition here would be a row that never clears.
      expect(ambientDeliveryKey(FILE_ID, 'the-mac')).toBe(
        sharedFileActivityId('the-mac', FILE_ID),
      );
    });

    it('refuses to name one for a file id that is not a real one', () => {
      // Loud rather than a made-up key: the id it would invent could never be matched by the transfer, so the
      // delivery would sit in the queue for ever with nothing able to clear it.
      expect(() => ambientDeliveryKey('shared-1', 'the-mac')).toThrow(
        'invalid activity sync id',
      );
    });
  });
});
