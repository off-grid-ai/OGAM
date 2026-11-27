import type {
  DeviceInfo,
  MembershipRevocationTombstone,
  PairedDevice,
  PendingMembershipRevocation,
  PersonalMeshInstallation,
} from '@offgrid/sync';
import { pairingSecretStore as store } from '../../../pro/sync/pairingSecretStore';

const KEYCHAIN_SERVICE = 'off-grid-sync-pairings';

/**
 * The phone's record of which devices it trusts, and the secrets that prove it.
 *
 * This is the most consequential store in the app: a secret lost means the user types a pairing code again, a
 * secret kept when it should not be means a revoked device can still be talked to, and a trust decision written
 * halfway means a device that is neither paired nor unpaired.
 *
 * So pairing is two-phase - staged, then committed - and the one rule that makes it safe is that a commit must
 * match what was staged. Everything else here is about the difference between "this peer did not answer" and
 * "trust is gone", which look identical on the wire and must not be treated the same.
 *
 * The keychain is stood in for; the trust document, its parser and the revocation state machine are real.
 */
describe('the devices this phone trusts', () => {
  let vault: Map<string, string>;

  const keychain = (): {
    getGenericPassword: jest.Mock;
    setGenericPassword: jest.Mock;
    resetGenericPassword: jest.Mock;
  } => require('react-native-keychain');

  const device = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
    id: 'the-mac',
    name: "Mac's MacBook Pro",
    platform: 'macos',
    version: '1',
    host: '192.168.1.50',
    port: 7777,
    ...overrides,
  });

  const paired = (overrides: Partial<PairedDevice> = {}): PairedDevice =>
    ({
      ...device(),
      sharedSecret: 'the-shared-secret',
      membershipId: 'membership-1',
      pairedAt: 1_700_000_000_000,
      lastConnected: 1_700_000_000_000,
      ...overrides,
    } as PairedDevice);

  const pending = (
    overrides: Partial<PendingMembershipRevocation> = {},
  ): PendingMembershipRevocation =>
    ({
      device: device(),
      membershipId: 'membership-1',
      revocationId: 'revocation-1',
      revocationSecret: 'the-revocation-secret',
      requestedAt: 1_700_000_000_000,
      ...overrides,
    } as PendingMembershipRevocation);

  const tombstone = (
    overrides: Partial<MembershipRevocationTombstone> = {},
  ): MembershipRevocationTombstone =>
    ({
      deviceId: 'the-mac',
      membershipId: 'membership-1',
      revocationId: 'revocation-1',
      revocationSecret: 'the-revocation-secret',
      revokedAt: 1_700_000_060_000,
      ...overrides,
    } as MembershipRevocationTombstone);

  const installation = (
    overrides: Partial<PersonalMeshInstallation> = {},
  ): PersonalMeshInstallation =>
    ({
      installationId: 'the-mac',
      syncDeviceId: 'the-mac',
      deviceName: "Mac's MacBook Pro",
      platform: 'macos',
      lastActiveAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
      ...overrides,
    } as PersonalMeshInstallation);

  /** What is actually in the keychain, as the next launch would read it. */
  const stored = (): Record<string, unknown> =>
    JSON.parse(vault.get(KEYCHAIN_SERVICE) ?? 'null');

  const trusted = async (): Promise<void> => {
    await store.load();
    await store.beginPairing(paired());
    await store.commitPairing(paired());
    await store.flush();
  };

  beforeEach(async () => {
    vault = new Map<string, string>();
    const secure = keychain();
    secure.getGenericPassword.mockImplementation(
      async ({ service }: { service: string }) => {
        const value = vault.get(service);
        return value ? { username: 'stored', password: value } : false;
      },
    );
    secure.setGenericPassword.mockImplementation(
      async (
        _user: string,
        password: string,
        { service }: { service: string },
      ) => {
        vault.set(service, password);
        return true;
      },
    );
    secure.resetGenericPassword?.mockImplementation?.(
      async ({ service }: { service: string }) => vault.delete(service),
    );
    store.resetCache();
  });

  describe('pairing a device', () => {
    it('trusts it, and remembers the secret that proves it', async () => {
      await trusted();

      expect(store.get('the-mac')).toBe('the-shared-secret');
      expect(store.known('the-mac')).toMatchObject({
        membershipId: 'membership-1',
        state: 'trusted',
      });
    });

    it('does not trust it until the pairing is committed', async () => {
      await store.load();

      await store.beginPairing(paired());

      // Staged only. A device trusted at the staging step would be trusted even if the handshake then failed,
      // and this phone would try to talk to a peer that never finished pairing with it.
      expect(store.known('the-mac')).toBeUndefined();
      expect(store.get('the-mac')).toBeUndefined();
    });

    it('refuses to commit a pairing that was never staged', async () => {
      await store.load();

      await expect(store.commitPairing(paired())).rejects.toThrow(
        'Pairing trust was not staged for this membership.',
      );
    });

    it('refuses to commit a different secret than the one staged', async () => {
      await store.load();
      await store.beginPairing(paired());

      // The two sides of a handshake must agree on the secret. Committing whatever arrives would let a later
      // message overwrite the trust the handshake actually established.
      await expect(
        store.commitPairing(paired({ sharedSecret: 'a-different-secret' })),
      ).rejects.toThrow('Pairing trust was not staged for this membership.');
    });

    it('refuses to commit a different membership than the one staged', async () => {
      await store.load();
      await store.beginPairing(paired());

      await expect(
        store.commitPairing(paired({ membershipId: 'membership-2' })),
      ).rejects.toThrow('Pairing trust was not staged for this membership.');
    });

    it('forgets a staged pairing that was abandoned', async () => {
      await store.load();
      await store.beginPairing(paired());

      await store.rollbackPairing('the-mac');

      // And committing afterwards fails, because there is nothing staged: a rollback that left the staging row
      // behind would let a failed handshake be completed later by accident.
      await expect(store.commitPairing(paired())).rejects.toThrow();
    });

    it('is happy rolling back a pairing that never started', async () => {
      await store.load();

      await expect(
        store.rollbackPairing('never-staged'),
      ).resolves.toBeUndefined();
    });

    it('keeps the name the user chose when a device re-pairs', async () => {
      await trusted();
      await store.rename('the-mac', 'The Studio Mac');

      await store.beginPairing(paired({ membershipId: 'membership-2' }));
      await store.commitPairing(paired({ membershipId: 'membership-2' }));

      // Re-pairing is not a reason to lose the name the user gave a device - they named it once, on purpose.
      expect(store.known('the-mac')?.alias).toBe('The Studio Mac');
    });

    it('clears an old revocation when the device pairs again', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());
      await store.completeLocal(pending(), tombstone());

      await store.beginPairing(paired({ membershipId: 'membership-2' }));
      await store.commitPairing(paired({ membershipId: 'membership-2' }));

      // A tombstone left behind would have the mesh revoke the membership it just created.
      expect(store.getTombstone('the-mac', 'membership-1')).toBeUndefined();
      expect(store.getPending('the-mac')).toBeUndefined();
    });
  });

  describe('surviving a relaunch', () => {
    it('reads the trust and the secret back', async () => {
      await trusted();

      store.resetCache();
      await store.load();

      // If the secret did not survive, every launch would ask the user to type their pairing code again.
      expect(store.get('the-mac')).toBe('the-shared-secret');
      expect(store.known('the-mac')?.state).toBe('trusted');
    });

    it('throws away anything that was still only staged', async () => {
      await store.load();
      await store.beginPairing(paired());
      await store.flush();

      store.resetCache();
      await store.load();

      // A handshake interrupted by the app being killed is a handshake that did not happen. Resuming a stale
      // staged row would commit trust neither side agreed to.
      expect(store.known('the-mac')).toBeUndefined();
      expect(stored().stagedPairings).toEqual({});
    });

    it('starts with nothing on a fresh install', async () => {
      await store.load();

      expect(store.list()).toEqual([]);
    });

    it('loads once however many things ask', async () => {
      const secure = keychain();
      secure.getGenericPassword.mockClear();

      await Promise.all([store.load(), store.load(), store.load()]);

      // Several surfaces start the mesh at once. Three concurrent loads would each clear the maps mid-read and
      // the last to finish would win, for reasons nobody could see.
      expect(secure.getGenericPassword).toHaveBeenCalledTimes(1);
    });

    it('does not read the keychain again once it has loaded', async () => {
      await store.load();
      const secure = keychain();
      secure.getGenericPassword.mockClear();

      await store.load();

      expect(secure.getGenericPassword).not.toHaveBeenCalled();
    });
  });

  describe('after an OS update breaks the Keystore key (Android 17)', () => {
    const KEYSTORE_ERROR = 'Wrapped error: Keystore operation failed';

    /** The pairings' Keystore key fails every read and write until the entry is reset. */
    const breakPairingsKey = (): void => {
      const secure = keychain();
      let broken = true;
      const get = secure.getGenericPassword.getMockImplementation()!;
      const set = secure.setGenericPassword.getMockImplementation()!;
      secure.getGenericPassword.mockImplementation(
        async (options: { service: string }) => {
          if (broken && options.service === KEYCHAIN_SERVICE) {
            throw new Error(KEYSTORE_ERROR);
          }
          return get(options);
        },
      );
      secure.setGenericPassword.mockImplementation(
        async (user: string, password: string, options: { service: string }) => {
          if (broken && options.service === KEYCHAIN_SERVICE) {
            throw new Error(KEYSTORE_ERROR);
          }
          return set(user, password, options);
        },
      );
      secure.resetGenericPassword.mockImplementation(
        async ({ service }: { service: string }) => {
          if (service === KEYCHAIN_SERVICE) broken = false;
          return vault.delete(service);
        },
      );
    };

    it('starts with no pairings instead of failing every launch', async () => {
      await trusted();
      breakPairingsKey();

      store.resetCache();
      await store.load();

      // The old pairings are behind a key nothing can read: sync and licence activation start again,
      // and the devices pair again.
      expect(store.list()).toEqual([]);
      expect(vault.has(KEYCHAIN_SERVICE)).toBe(false);
    });

    it('saves a new pairing after the reset', async () => {
      breakPairingsKey();
      await trusted();

      store.resetCache();
      await store.load();

      expect(store.get('the-mac')).toBe('the-shared-secret');
    });
  });

  describe('a peer that did not recognise this device', () => {
    it('keeps the secret and asks for a repair instead of the code', async () => {
      await trusted();

      await store.markNeedsRepair(device());

      // `unknown_device` is NOT proof that trust is gone - a peer that is restarting, or whose store has not
      // finished loading, answers identically. The user proved possession once; throwing the credential away on
      // one unanswered handshake makes them prove it again for nothing.
      expect(store.known('the-mac')?.state).toBe('needs_repair');
      expect(store.get('the-mac')).toBe('the-shared-secret');
    });

    it('keeps the name and the pairing date through a repair', async () => {
      await trusted();
      await store.rename('the-mac', 'The Studio Mac');

      await store.markNeedsRepair(device());

      expect(store.known('the-mac')).toMatchObject({
        alias: 'The Studio Mac',
        pairedAt: 1_700_000_000_000,
      });
    });

    it('records one even for a device it has never seen', async () => {
      await store.load();

      await store.markNeedsRepair(device({ id: 'a-stranger' }));

      // Reached from discovery, which can meet a device this phone has no row for. A throw here would take down
      // the scan over a peer that is merely unknown.
      expect(store.known('a-stranger')?.state).toBe('needs_repair');
    });

    it('clears the repair state on the next successful pairing', async () => {
      await trusted();
      await store.markNeedsRepair(device());

      await store.beginPairing(paired());
      await store.commitPairing(paired());

      // No typing: the whole point of keeping the secret is that the next handshake fixes it silently.
      expect(store.known('the-mac')?.state).toBe('trusted');
    });
  });

  describe('what discovery keeps up to date', () => {
    it('refreshes where a device is without changing whether it is trusted', async () => {
      await trusted();

      await store.observe(device({ host: '192.168.1.99', port: 8888 }));

      // The address changes every time the user joins a different network; the trust decision does not.
      expect(store.known('the-mac')).toMatchObject({
        state: 'trusted',
        device: expect.objectContaining({ host: '192.168.1.99', port: 8888 }),
      });
      expect(store.get('the-mac')).toBe('the-shared-secret');
    });

    it('does not start trusting a device just because it appeared', async () => {
      await store.load();

      await store.observe(device({ id: 'a-stranger' }));

      // Seeing a device is not pairing with it. A row created here would put an unpaired device in the saved list.
      expect(store.known('a-stranger')).toBeUndefined();
    });

    it('adopts a device from a build that stored only its secret', async () => {
      // The v1 shape: a bag of secrets under `secrets`, with no trust rows at all.
      vault.set(
        KEYCHAIN_SERVICE,
        JSON.stringify({
          version: 1,
          secrets: { 'the-mac': 'a-secret-from-an-older-build' },
        }),
      );
      await store.load();
      expect(store.known('the-mac')).toBeUndefined();

      await store.observe(device());

      // The legacy format held secrets with no trust rows. The first sighting promotes it, so an upgrade does not
      // silently unpair every device the user already had.
      expect(store.known('the-mac')?.state).toBe('trusted');
      expect(store.get('the-mac')).toBe('a-secret-from-an-older-build');
    });
  });

  describe('renaming a device', () => {
    it('remembers the name across a relaunch', async () => {
      await trusted();

      await expect(store.rename('the-mac', '  The Studio Mac  ')).resolves.toBe(
        'The Studio Mac',
      );

      await store.flush();
      store.resetCache();
      await store.load();
      expect(store.known('the-mac')?.alias).toBe('The Studio Mac');
    });

    it('refuses an empty name', async () => {
      await trusted();

      await expect(store.rename('the-mac', '   ')).rejects.toThrow(
        'Enter a device name.',
      );
    });

    it('cuts a name too long to show', async () => {
      await trusted();

      await expect(
        store.rename('the-mac', 'x'.repeat(200)),
      ).resolves.toHaveLength(64);
    });

    it('refuses to rename a device it no longer has', async () => {
      await store.load();

      await expect(store.rename('a-stranger', 'Anything')).rejects.toThrow(
        'This device is no longer saved.',
      );
    });
  });

  describe('revoking a membership from this device', () => {
    it('destroys the trust and the secret, and remembers why', async () => {
      await trusted();

      await expect(store.beginLocal(paired(), pending())).resolves.toBe(true);

      // Here the secret IS deleted, because this is the case where losing trust is the actual intent - unlike a
      // peer that merely failed to answer.
      expect(store.get('the-mac')).toBeUndefined();
      expect(store.known('the-mac')).toBeUndefined();
      expect(store.getPending('the-mac')).toMatchObject({
        revocationId: 'revocation-1',
      });
      // The revocation secret survives, because the peer still has to be told - and told provably.
      expect(store.getRevocationSecret('the-mac', 'membership-1')).toBe(
        'the-revocation-secret',
      );
    });

    it('refuses to revoke a membership this phone no longer holds', async () => {
      await trusted();

      // The membership moved on - a re-pair, or another device's revocation landing first. Revoking the wrong one
      // would take away trust the user has just re-established.
      await expect(
        store.beginLocal(paired({ membershipId: 'membership-2' }), pending()),
      ).resolves.toBe(false);
      expect(store.known('the-mac')?.state).toBe('trusted');
    });

    it('finishes the revocation once the peer has been told', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());

      await expect(store.completeLocal(pending(), tombstone())).resolves.toBe(
        true,
      );

      // The pending row goes and a tombstone stays: the tombstone is what stops the same membership being
      // re-accepted if the peer offers it again.
      expect(store.getPending('the-mac')).toBeUndefined();
      expect(store.getTombstone('the-mac', 'membership-1')).toMatchObject({
        revocationId: 'revocation-1',
      });
    });

    it('will not finish a revocation that does not match the one in flight', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());

      await expect(
        store.completeLocal(
          pending({ revocationId: 'revocation-2' }),
          tombstone(),
        ),
      ).resolves.toBe(false);
      expect(store.getPending('the-mac')).toBeDefined();
    });

    it('will not finish one that was never started', async () => {
      await store.load();

      await expect(store.completeLocal(pending(), tombstone())).resolves.toBe(
        false,
      );
    });

    it('lists every revocation still waiting to reach its peer', async () => {
      await trusted();
      await store.beginPairing(
        paired({ id: 'the-ipad', membershipId: 'membership-9' }),
      );
      await store.commitPairing(
        paired({ id: 'the-ipad', membershipId: 'membership-9' }),
      );
      await store.beginLocal(paired(), pending());
      await store.beginLocal(
        paired({ id: 'the-ipad', membershipId: 'membership-9' }),
        pending({
          device: device({ id: 'the-ipad' }),
          membershipId: 'membership-9',
          revocationId: 'revocation-9',
        }),
      );

      // The retry loop works from this list. A revocation missing from it is a peer that is never told, and a
      // device that keeps syncing after the user removed it.
      expect(
        store
          .listPending()
          .map(({ revocationId }) => revocationId)
          .sort(),
      ).toEqual(['revocation-1', 'revocation-9']);
    });

    it('takes a dismissal back off again', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());
      await store.setPendingDismissed(
        'the-mac',
        'revocation-1',
        1_700_000_090_000,
      );

      await expect(
        store.setPendingDismissed('the-mac', 'revocation-1'),
      ).resolves.toBe(true);

      // Called with no time at all, which is how the notice comes back: the revocation is still in flight and
      // the user should see it again rather than it being permanently silenced.
      expect(store.getPending('the-mac')?.dismissedAt).toBeUndefined();
    });

    it('lets the user dismiss the notice without forgetting the revocation', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());

      await expect(
        store.setPendingDismissed('the-mac', 'revocation-1', 1_700_000_090_000),
      ).resolves.toBe(true);

      // Dismissed is about the notice, not the work: the revocation still has to reach the peer.
      expect(store.getPending('the-mac')).toMatchObject({
        dismissedAt: 1_700_000_090_000,
        revocationId: 'revocation-1',
      });
    });

    it('ignores a dismissal for a revocation that is not the current one', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());

      await expect(
        store.setPendingDismissed('the-mac', 'revocation-2'),
      ).resolves.toBe(false);
    });

    it('ignores a dismissal for a device with nothing pending', async () => {
      await store.load();

      await expect(
        store.setPendingDismissed('the-mac', 'revocation-1'),
      ).resolves.toBe(false);
    });
  });

  describe('a membership revoked by the other device', () => {
    it('destroys the trust and records the tombstone', async () => {
      await trusted();

      await expect(store.applyRemote(paired(), tombstone())).resolves.toBe(
        true,
      );

      expect(store.get('the-mac')).toBeUndefined();
      expect(store.known('the-mac')).toBeUndefined();
      expect(store.getTombstone('the-mac', 'membership-1')).toBeDefined();
    });

    it('ignores a revocation of a membership this phone no longer holds', async () => {
      await trusted();

      // A revocation that arrives after the device re-paired must not undo the new pairing.
      await expect(
        store.applyRemote(
          paired({ membershipId: 'membership-2' }),
          tombstone(),
        ),
      ).resolves.toBe(false);
      expect(store.known('the-mac')?.state).toBe('trusted');
    });

    it('keeps a revocation waiting across a relaunch', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());
      await store.flush();

      store.resetCache();
      await store.load();

      // The peer has still not been told. Losing this on a relaunch would leave a device revoked here and live
      // there, with nothing left to drive the retry.
      expect(
        store.listPending().map(({ revocationId }) => revocationId),
      ).toEqual(['revocation-1']);
    });

    it('remembers the tombstone across a relaunch', async () => {
      await trusted();
      await store.applyRemote(paired(), tombstone());
      await store.flush();

      store.resetCache();
      await store.load();

      // Without this, a relaunch would accept the revoked membership again and the device would come back.
      expect(store.getTombstone('the-mac', 'membership-1')).toBeDefined();
      expect(store.getRevocationSecret('the-mac', 'membership-1')).toBe(
        'the-revocation-secret',
      );
    });

    it('has no revocation secret for a membership it knows nothing about', async () => {
      await store.load();

      expect(
        store.getRevocationSecret('the-mac', 'membership-9'),
      ).toBeUndefined();
    });
  });

  describe('making room on the licence', () => {
    it('prepares a replacement for a device it is paired with', async () => {
      await trusted();

      const id = await store.prepareCapacityReplacement(installation());

      expect(store.capacityReplacement(id)).toMatchObject({
        membershipId: 'membership-1',
        state: 'prepared',
      });
      expect(store.listCapacityReplacements()).toHaveLength(1);
    });

    it('prepares one for a device it has never paired with', async () => {
      await store.load();

      const id = await store.prepareCapacityReplacement(
        installation({
          installationId: 'a-stranger',
          syncDeviceId: 'a-stranger',
        }),
      );

      // This used to throw, which aborted the eviction before the licence seat was released - so a device you
      // had never paired with could not be removed from your OWN licence, and the failure was invisible. The
      // transaction simply has an empty local side.
      expect(store.capacityReplacement(id)).toMatchObject({
        state: 'prepared',
      });
      expect(store.capacityReplacement(id)?.membershipId).toBeUndefined();
    });

    it('commits a replacement so it survives a relaunch', async () => {
      await trusted();
      const id = await store.prepareCapacityReplacement(installation());

      await store.commitCapacityReplacement(id);
      await store.flush();
      store.resetCache();
      await store.load();

      // Committed replacements are resumed after a crash; a prepared one is not, because it can still be undone.
      expect(store.capacityReplacement(id)).toMatchObject({
        state: 'committed',
      });
    });

    it('forgets a replacement that was undone', async () => {
      await trusted();
      const id = await store.prepareCapacityReplacement(installation());

      await store.rollbackCapacityReplacement(id);

      expect(store.capacityReplacement(id)).toBeUndefined();
    });

    it('forgets a replacement that finished', async () => {
      await trusted();
      const id = await store.prepareCapacityReplacement(installation());
      await store.commitCapacityReplacement(id);

      await store.completeCapacityReplacement(id);

      expect(store.capacityReplacement(id)).toBeUndefined();
    });

    it('is happy undoing or finishing one it does not have', async () => {
      await store.load();

      await expect(
        store.rollbackCapacityReplacement('never-prepared'),
      ).resolves.toBeUndefined();
      await expect(
        store.completeCapacityReplacement('never-prepared'),
      ).resolves.toBeUndefined();
    });
  });

  describe('what it hands out', () => {
    it('gives copies, so a caller cannot edit the trust in place', async () => {
      await trusted();

      const first = store.known('the-mac')!;
      first.device.name = 'Renamed by a caller';
      first.state = 'needs_repair';

      // The saved list is rendered from these. A caller that could mutate them would change the trust decision
      // without a write, and the next launch would disagree with the screen.
      expect(store.known('the-mac')).toMatchObject({
        state: 'trusted',
        device: expect.objectContaining({ name: "Mac's MacBook Pro" }),
      });
    });

    it('gives copies of the list too', async () => {
      await trusted();

      const list = store.list();
      list[0]!.device.host = '10.0.0.1';

      expect(store.list()[0]?.device.host).toBe('192.168.1.50');
    });

    it('gives copies of a pending revocation and a tombstone', async () => {
      await trusted();
      await store.beginLocal(paired(), pending());
      const inFlight = store.getPending('the-mac')!;
      inFlight.revocationId = 'edited';
      await store.completeLocal(pending(), tombstone());
      const recorded = store.getTombstone('the-mac', 'membership-1')!;
      recorded.revocationId = 'edited';

      expect(store.getTombstone('the-mac', 'membership-1')?.revocationId).toBe(
        'revocation-1',
      );
    });

    it('knows nothing about a device it has never met', async () => {
      await store.load();

      expect(store.known('a-stranger')).toBeUndefined();
      expect(store.get('a-stranger')).toBeUndefined();
      expect(store.getActive('a-stranger')).toBeUndefined();
    });

    it('gives the active pairing a revocation has to match', async () => {
      await trusted();

      expect(store.getActive('the-mac')).toMatchObject({
        id: 'the-mac',
        sharedSecret: 'the-shared-secret',
        membershipId: 'membership-1',
      });
    });
  });

  describe('when the keychain will not take the write', () => {
    it('undoes the trust it could not save', async () => {
      await trusted();
      keychain().setGenericPassword.mockResolvedValue(false);

      await expect(store.beginLocal(paired(), pending())).rejects.toThrow(
        'Keychain did not save the pairing.',
      );

      // Rolled back in memory: a revocation the keychain refused would otherwise leave this phone distrusting a
      // device that is still trusted on disk - and the next launch would disagree with the screen.
      expect(store.known('the-mac')?.state).toBe('trusted');
      expect(store.get('the-mac')).toBe('the-shared-secret');
      expect(store.getPending('the-mac')).toBeUndefined();
    });

    it('undoes a pairing it could not save', async () => {
      await store.load();
      keychain().setGenericPassword.mockRejectedValue(
        new Error('the keychain is locked'),
      );

      await expect(store.beginPairing(paired())).rejects.toThrow(
        'the keychain is locked',
      );

      // Nothing staged, so nothing can be committed: a pairing that appeared to stage but was never written
      // would be committed later against a document that has no record of it.
      expect(store.known('the-mac')).toBeUndefined();
      await expect(store.commitPairing(paired())).rejects.toThrow();
    });

    it('carries on writing the light-touch updates after a refusal', async () => {
      await trusted();
      const secure = keychain();
      secure.setGenericPassword.mockRejectedValueOnce(
        new Error('the keychain is locked'),
      );

      // `observe` and `markNeedsRepair` write through a queue that recovers rather than rejecting - they are
      // discovery bookkeeping, and a locked keychain must not stop the next sighting being recorded.
      await store.observe(device({ host: '10.0.0.5' })).catch(() => undefined);
      await store.observe(device({ host: '10.0.0.9' }));

      expect(store.known('the-mac')?.device.host).toBe('10.0.0.9');
      expect(JSON.parse(vault.get(KEYCHAIN_SERVICE) ?? 'null')).toMatchObject({
        pairings: { 'the-mac': { device: { host: '10.0.0.9' } } },
      });
    });

    it('carries on once the keychain works again', async () => {
      await store.load();
      const secure = keychain();
      secure.setGenericPassword.mockRejectedValueOnce(
        new Error('the keychain is locked'),
      );

      // Not awaited before the next call: the second mutation queues BEHIND a write that is going to fail, which
      // is the ordering that matters - it must run rather than inheriting the rejection.
      const failing = store.beginPairing(paired()).catch(() => undefined);
      await store.beginPairing(paired());
      await failing;
      await store.commitPairing(paired());

      // The write queue is serial, so one refusal must not poison it - otherwise a single locked moment would
      // stop every later pairing on this phone from being saved.
      expect(store.known('the-mac')?.state).toBe('trusted');
    });
  });

  it('writes in the format the next launch reads', async () => {
    await trusted();

    // Read back raw: the version is what the parser checks first, and a document written under a version it
    // does not know is a document that unpairs every device on the next launch.
    expect(stored()).toMatchObject({ version: expect.any(Number) });
    expect(Object.keys(stored().pairings as object)).toEqual(['the-mac']);
  });
});
