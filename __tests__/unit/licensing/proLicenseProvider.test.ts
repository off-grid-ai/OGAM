import { PERSONAL_MESH_ENTITLEMENT_REVALIDATION_INTERVAL_MS } from '@offgrid/sync';
import { createKeygenFake, type KeygenFake } from '../../harness/keygenFake';

const LICENCE_KEY = 'OFFGRID-MOBILE-LICENCE';
const FINGERPRINT = 'fp-this-phone';

/**
 * The licence this phone holds, and what happens to it over time.
 *
 * This owns the answer to "is this device licensed", which gates every pro surface - so the failure modes are
 * about the answer being wrong in one of two directions. Wrongly licensed means someone keeps paid features
 * after a refund; wrongly unlicensed means a paying user on a plane loses the app they bought.
 *
 * Activation is a transaction with the mesh: a seat is claimed, the credential is written, the credential is
 * READ BACK, and only then is the claim committed. The readback is the interesting part - a credential the
 * keychain accepted but cannot return is a phone that believes it is licensed and cannot prove it after a
 * relaunch.
 *
 * The Keygen client, the credential store and the store flag all run for real. Only the HTTP endpoint, the
 * keychain and the device fingerprint are substituted.
 */
describe('the licence this phone holds', () => {
  let keygen: KeygenFake;
  let secrets: Map<string, string>;

  /**
   * The mesh side of activation: it claims the seat, and can be made to refuse at any stage.
   *
   * Claiming means REGISTERING this phone with the provider, which is what the real owner does (covered by its
   * own suite). Without that the licence would hold no installation for this device and the very next
   * revalidation would report the seat missing - so a fake that only returned a transaction id would make every
   * test after activation lie.
   */
  const activationOwner = (
    overrides: Partial<{
      prepare: () => Promise<string>;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
      finalize: () => Promise<void>;
    }> = {},
  ) => {
    const calls: string[] = [];
    return {
      calls,
      owner: {
        prepareDirectActivation: async () => {
          calls.push('prepare');
          if (overrides.prepare) return overrides.prepare();
          keygen.activate({
            key: LICENCE_KEY,
            fingerprint: FINGERPRINT,
            name: "Mac's iPhone",
            platform: 'ios',
          });
          return 'transaction-1';
        },
        commitDirectActivation: async () => {
          calls.push('commit');
          await overrides.commit?.();
        },
        rollbackDirectActivation: async () => {
          calls.push('rollback');
          keygen.forget(FINGERPRINT);
          await overrides.rollback?.();
        },
        finalizeDirectActivation: async () => {
          calls.push('finalize');
          await overrides.finalize?.();
        },
      },
    };
  };

  const load = () =>
    require('../../../pro/licensing/proLicenseProvider') as typeof import('../../../pro/licensing/proLicenseProvider');

  const keychain = (): {
    getGenericPassword: jest.Mock;
    setGenericPassword: jest.Mock;
    resetGenericPassword: jest.Mock;
  } => require('react-native-keychain');

  beforeEach(() => {
    jest.resetModules();
    secrets = new Map<string, string>();
    const store = keychain();
    store.getGenericPassword.mockImplementation(
      async ({ service }: { service: string }) => {
        const value = secrets.get(service);
        return value ? { username: 'stored', password: value } : false;
      },
    );
    store.setGenericPassword.mockImplementation(
      async (
        _user: string,
        password: string,
        { service }: { service: string },
      ) => {
        secrets.set(service, password);
        return true;
      },
    );
    store.resetGenericPassword?.mockImplementation?.(
      async ({ service }: { service: string }) => secrets.delete(service),
    );
    secrets.set('off-grid-device-fingerprint', FINGERPRINT);

    keygen = createKeygenFake();
    keygen.install();
    keygen.reset();
    keygen.addLicence({ key: LICENCE_KEY, seats: 3 });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await load()
      .proLicenseProvider.clearForTesting?.()
      .catch(() => undefined);
    jest.useRealTimers();
    keygen.restore();
    jest.restoreAllMocks();
  });

  describe('pasting a licence key', () => {
    it('licenses the phone and puts it on the licence', async () => {
      const provider = load();
      const mesh = activationOwner();
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      await expect(
        provider.proLicenseProvider.activate!(LICENCE_KEY),
      ).resolves.toEqual({
        ok: true,
      });

      // The claim is committed and then finalized, in that order: finalize is what tells the rest of the app the
      // roster moved, and doing it before the credential was safely stored would announce a licence that could
      // still be rolled back.
      expect(mesh.calls).toEqual(['prepare', 'commit', 'finalize']);
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
    });

    it('accepts a key an email client wrapped', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);

      // Keygen keys never contain whitespace, so a line break from a wrapped message is normalised rather than
      // submitted as a different key - which would read as "invalid licence" to someone holding a valid one.
      await expect(
        provider.proLicenseProvider.activate!(
          `  ${LICENCE_KEY.slice(0, 8)}\n${LICENCE_KEY.slice(8)}  `,
        ),
      ).resolves.toEqual({ ok: true });
    });

    it('refuses an empty key without asking the provider', async () => {
      const provider = load();

      await expect(
        provider.proLicenseProvider.activate!('   '),
      ).resolves.toEqual({
        ok: false,
        reason: 'invalid_credential',
      });
      expect(keygen.calls).toEqual([]);
    });

    it('says the key is not valid rather than guessing', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);

      await expect(
        provider.proLicenseProvider.activate!('OFFGRID-NOT-A-KEY'),
      ).resolves.toEqual({ ok: false, reason: 'invalid_credential' });
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('says the licence expired, which is a different thing the user can act on', async () => {
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: '2020-01-01T00:00:00.000Z',
      });
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);

      const result = await provider.proLicenseProvider.activate!(LICENCE_KEY);

      // Expired means renew; invalid means check what you typed. Collapsing them would send someone to the wrong
      // place, and they have already paid.
      expect(result.ok).toBe(false);
    });

    it('claims a seat when this phone is not yet on a licence that has room', async () => {
      // The phone holds the key but has never registered - the fresh-activation path, which is the normal one.
      const provider = load();
      const mesh = activationOwner();
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      await expect(
        provider.proLicenseProvider.activate!(LICENCE_KEY),
      ).resolves.toEqual({
        ok: true,
      });
      expect(
        keygen.machines(LICENCE_KEY).map(({ fingerprint }) => fingerprint),
      ).toContain(FINGERPRINT);
    });

    it('still claims a seat when the licence reports itself over the cap', async () => {
      keygen.reset();
      keygen.addLicence({ key: LICENCE_KEY, seats: 1 });
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      const provider = load();
      const mesh = activationOwner();
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      // TOO_MANY_MACHINES is not a refusal here: replacing a device is the MESH's transaction, and this provider
      // hands off to it rather than telling the user their licence is full when a seat can be freed.
      expect(mesh.calls).toContain('prepare');
    });

    it('says it could not reach the licence rather than blaming the key', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      keygen.setOffline(true);

      await expect(
        provider.proLicenseProvider.activate!(LICENCE_KEY),
      ).resolves.toEqual({
        ok: false,
        reason: 'network_unavailable',
      });
    });

    it('waits through delayed Sync startup for the registration owner', async () => {
      jest.useFakeTimers();
      const provider = load();
      const mesh = activationOwner();

      const activation = provider.proLicenseProvider.activate!(LICENCE_KEY);
      setTimeout(
        () => provider.setDirectEntitlementActivationOwner(mesh.owner),
        6_000,
      );

      await jest.advanceTimersByTimeAsync(6_000);
      await expect(activation).resolves.toEqual({ ok: true });
      expect(mesh.calls).toEqual(['prepare', 'commit', 'finalize']);
    });

    it('reports local activation startup when the registration owner never arrives', async () => {
      jest.useFakeTimers();
      const provider = load();

      // No activation owner registered: on a build where sync has not started, the seat cannot be claimed. This
      // is local startup state, not proof that the licence service could not be reached.
      const activation = provider.proLicenseProvider.activate!(LICENCE_KEY);
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(activation).resolves.toEqual({
        ok: false,
        reason: 'activation_unavailable',
      });
    });

    it('lets the mesh be swapped out and put back', async () => {
      const provider = load();
      const first = activationOwner();
      const detach = provider.setDirectEntitlementActivationOwner(first.owner);

      detach();
      const second = activationOwner();
      provider.setDirectEntitlementActivationOwner(second.owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      // Sync stops and starts within a session - a signed-out and signed-in mesh, a restarted service. The
      // detach must only clear the owner it registered, or a later owner is silently discarded and activation
      // waits for a mesh that is right there.
      expect(second.calls).toContain('prepare');
      expect(first.calls).toEqual([]);
    });

    it('leaves a later mesh in place when an earlier one detaches', async () => {
      const provider = load();
      const first = activationOwner();
      const detach = provider.setDirectEntitlementActivationOwner(first.owner);
      const second = activationOwner();
      provider.setDirectEntitlementActivationOwner(second.owner);

      // The first owner's detach arrives late, after the second has taken over.
      detach();
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      expect(second.calls).toContain('prepare');
    });

    it('restores the previous licence when activation fails over an existing one', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      // A second key pasted over a licence this phone already holds, which then fails to commit.
      const failing = activationOwner({
        commit: async () => {
          throw new Error('the transaction is gone');
        },
      });
      provider.setDirectEntitlementActivationOwner(failing.owner);

      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      // The licence they HAD is put back: a failed upgrade attempt must not cost someone the entitlement they
      // were already using.
      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        credentialSaved: true,
      });
    });

    it('says secure storage is unavailable when the fingerprint cannot be read', async () => {
      secrets.delete('off-grid-device-fingerprint');
      keychain().getGenericPassword.mockRejectedValue(
        new Error('keychain locked'),
      );
      const provider = load();

      // The fingerprint IS this device's identity on the licence. Without it there is nothing to register, and
      // the message points at the phone rather than at the key the user just typed.
      await expect(
        provider.proLicenseProvider.activate!(LICENCE_KEY),
      ).resolves.toEqual({
        ok: false,
        reason: 'secure_storage_unavailable',
      });
    });
  });

  describe('when activation cannot be completed', () => {
    it('gives the seat back when the mesh refuses to claim one', async () => {
      const provider = load();
      const mesh = activationOwner({
        prepare: async () => {
          throw new Error('the licence is full');
        },
      });
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      const result = await provider.proLicenseProvider.activate!(LICENCE_KEY);

      expect(result.ok).toBe(false);
      // Nothing to roll back, because nothing was claimed - and the phone is not licensed.
      expect(mesh.calls).toEqual(['prepare']);
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('rolls the claim back when the credential cannot be stored', async () => {
      const provider = load();
      const mesh = activationOwner();
      provider.setDirectEntitlementActivationOwner(mesh.owner);
      keychain().setGenericPassword.mockRejectedValue(
        new Error('the keychain is locked'),
      );

      const result = await provider.proLicenseProvider.activate!(LICENCE_KEY);

      // A seat claimed for a phone that could not keep its credential is a seat consumed by nothing, and no
      // screen anywhere from which to free it.
      expect(result.ok).toBe(false);
      expect(mesh.calls).toEqual(['prepare', 'rollback']);
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('rolls back when the credential is written but cannot be read again', async () => {
      const provider = load();
      const mesh = activationOwner();
      provider.setDirectEntitlementActivationOwner(mesh.owner);
      // The write reports success and the readback returns nothing - a keychain that accepted a secret it cannot
      // return. Without this check the phone believes it is licensed and cannot prove it after a relaunch.
      keychain().getGenericPassword.mockImplementation(
        async ({ service }: { service: string }) =>
          service === 'off-grid-device-fingerprint'
            ? { username: 'stored', password: FINGERPRINT }
            : false,
      );

      const result = await provider.proLicenseProvider.activate!(LICENCE_KEY);

      expect(result.ok).toBe(false);
      expect(mesh.calls).toEqual(['prepare', 'rollback']);
    });

    it('rolls back when the mesh refuses to commit', async () => {
      const provider = load();
      const mesh = activationOwner({
        commit: async () => {
          throw new Error('the transaction is gone');
        },
      });
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      const result = await provider.proLicenseProvider.activate!(LICENCE_KEY);

      expect(result.ok).toBe(false);
      expect(mesh.calls).toEqual(['prepare', 'commit', 'rollback']);
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('licenses the phone even when the last step will have to be resumed', async () => {
      const provider = load();
      const mesh = activationOwner({
        finalize: async () => {
          throw new Error('the peer could not be told yet');
        },
      });
      provider.setDirectEntitlementActivationOwner(mesh.owner);

      // Finalize only announces a replacement that is already durable, so a failure there is resumed later. The
      // user paid and typed their key: refusing them the app over the last step would be the wrong direction.
      await expect(
        provider.proLicenseProvider.activate!(LICENCE_KEY),
      ).resolves.toEqual({
        ok: true,
      });
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
    });
  });

  describe('what the Settings screen shows', () => {
    it('says nothing is stored on a fresh install', async () => {
      const provider = load();

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: false,
        tier: null,
      });
    });

    it('calls a licence with no expiry a lifetime one', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: true,
        credentialSaved: true,
        tier: 'lifetime',
        expiry: null,
      });
    });

    it('shows a legacy timed licence as a neutral subscription', async () => {
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: '2030-01-01T00:00:00.000Z',
      });
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: true,
        tier: 'subscription',
        expiry: '2030-01-01T00:00:00.000Z',
      });
    });

    it('shows the new RevenueCat key as a monthly plan', async () => {
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: '2030-01-01T00:00:00.000Z',
        metadata: { tier: 'monthly' },
      });
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: true,
        tier: 'monthly',
      });
    });

    it('survives a keychain that cannot be read at all', async () => {
      const provider = load();
      keychain().getGenericPassword.mockRejectedValue(
        new Error('keychain locked'),
      );

      // Reported as unlicensed rather than thrown: this runs while Settings renders, and a throw there is a
      // screen the user cannot open to fix the problem.
      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: false,
      });
    });
  });

  describe('re-checking the licence later', () => {
    const licensed = async (): Promise<
      typeof import('../../../pro/licensing/proLicenseProvider')
    > => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      return provider;
    };

    it('keeps the phone licensed when the licence is still good', async () => {
      const provider = await licensed();

      await provider.proLicenseProvider.revalidate!('launch');

      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
    });

    it('removes access at the exact cached expiry without a restart', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: '2030-01-01T00:00:05.000Z',
      });
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
      await jest.advanceTimersByTimeAsync(5_001);

      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: true,
      });
    });

    it('locks the app when the licence has been revoked', async () => {
      const provider = await licensed();
      // Refunded, charged back, or revoked by an admin: the provider stops recognising the key.
      keygen.reset();

      await provider.proLicenseProvider.revalidate!('launch');

      // This is the whole point of re-checking: paid features must not outlive the payment.
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('keeps cached access when the licence cannot be reached', async () => {
      const provider = await licensed();
      keygen.setOffline(true);

      await provider.proLicenseProvider.revalidate!('launch');

      // A plane is not a refund. Locking the app offline would take a paid product away from someone who paid
      // for exactly the offline case.
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
    });

    it('closes a saved credential locally before a throttled foreground check', async () => {
      const start = Date.UTC(2026, 7, 26, 9, 0, 0);
      let now = start;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: new Date(start + 5_000).toISOString(),
      });
      const provider = await licensed();
      await provider.proLicenseProvider.revalidate!('peer_connected');
      const providerCalls = keygen.calls.length;

      now = start + 5_000;
      await provider.proLicenseProvider.revalidate!('foreground');

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: true,
        expired: true,
      });
      // The local deadline closes access first. An expired credential bypasses the ordinary
      // foreground throttle so an authoritative renewal can restore access in this session.
      expect(keygen.calls).toHaveLength(providerCalls + 1);
    });

    it('reports an expired saved credential as inactive on cold start', async () => {
      secrets.set(
        'off-grid-pro-license',
        JSON.stringify({
          isPro: true,
          key: LICENCE_KEY,
          licenseId: 'licence-1',
          expiry: new Date(Date.now() - 1).toISOString(),
          verifiedAt: Date.now() - 10_000,
        }),
      );
      const provider = load();

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: true,
        expired: true,
      });
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });

    it('closes access at the exact saved deadline without a network event', async () => {
      jest.useFakeTimers();
      const start = Date.UTC(2026, 7, 26, 9, 0, 0);
      jest.setSystemTime(start);
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: new Date(start + 5_000).toISOString(),
      });
      const provider = await licensed();
      const decisions: boolean[] = [];
      provider.onProLicenseInfoChanged(info => decisions.push(info.isPro));
      const providerCalls = keygen.calls.length;

      await jest.advanceTimersByTimeAsync(5_000);

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        expired: true,
      });
      expect(decisions).toContain(false);
      expect(keygen.calls).toHaveLength(providerCalls);
      jest.useRealTimers();
    });

    it('serializes expiry shutdown and Keygen renewal without an app restart', async () => {
      jest.useFakeTimers();
      const start = Date.UTC(2026, 7, 26, 9, 0, 0);
      jest.setSystemTime(start);
      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: new Date(start + 5_000).toISOString(),
      });
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      const runtimeChanges: string[] = [];
      const { createEntitlementRuntimeTransition } =
        require('../../../pro/licensing/entitlementRuntimeTransition') as typeof import('../../../pro/licensing/entitlementRuntimeTransition');
      const runtime = createEntitlementRuntimeTransition({
        activate: async () => {
          runtimeChanges.push('activate');
        },
        deactivate: async () => {
          runtimeChanges.push('deactivate');
        },
        report: error => {
          throw error;
        },
      });
      const stop = provider.onProLicenseInfoChanged(runtime.apply);

      await jest.advanceTimersByTimeAsync(5_000);
      await runtime.settled();
      expect(runtimeChanges).toEqual(['deactivate']);

      keygen.reset();
      keygen.addLicence({
        key: LICENCE_KEY,
        seats: 3,
        expiry: new Date(start + 60_000).toISOString(),
      });
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: "Mac's iPhone",
        platform: 'ios',
      });
      await provider.proLicenseProvider.revalidate!('foreground');
      await runtime.settled();

      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        true,
      );
      expect(runtimeChanges).toEqual(['deactivate', 'activate']);
      stop();
      jest.useRealTimers();
    });

    it('keeps lifetime access active when time advances', async () => {
      jest.useFakeTimers();
      const start = Date.UTC(2026, 7, 26, 9, 0, 0);
      jest.setSystemTime(start);
      const provider = await licensed();

      await jest.advanceTimersByTimeAsync(10 * 365 * 24 * 60 * 60 * 1_000);

      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: true,
        tier: 'lifetime',
        expiry: null,
        expired: false,
      });
      jest.useRealTimers();
    });

    it('stops active access but keeps the credential when the seat is gone', async () => {
      const provider = await licensed();
      // The seat was freed from another device: the key is still valid, this installation is not on it.
      keygen.forget(FINGERPRINT);

      await provider.proLicenseProvider.revalidate!('launch');

      // Not licensed, but the credential is kept so the user can reactivate without finding their key again -
      // and only an explicit action may re-create the installation.
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        isPro: false,
        credentialSaved: true,
      });
    });

    it('does nothing when there is no licence to re-check', async () => {
      const provider = load();

      await provider.proLicenseProvider.revalidate!('launch');

      expect(keygen.calls).toEqual([]);
    });

    it('does not re-check every time a peer connects', async () => {
      const provider = await licensed();
      const before = keygen.calls.length;

      await provider.proLicenseProvider.revalidate!('peer_connected');
      await provider.proLicenseProvider.revalidate!('peer_connected');

      // Rate limited: a mesh whose peers come and go every few seconds would otherwise ask the provider every
      // few seconds, which is both wasteful and the kind of traffic that gets an account limited.
      expect(keygen.calls.length).toBeLessThanOrEqual(before + 1);
    });

    it('always re-checks on launch, whatever happened before', async () => {
      const provider = await licensed();
      await provider.proLicenseProvider.revalidate!('peer_connected');
      const before = keygen.calls.length;

      await provider.proLicenseProvider.revalidate!('launch');

      // Launch is the one moment the user is waiting to find out, so it bypasses the rate limit.
      expect(keygen.calls.length).toBeGreaterThan(before);
    });

    it('shares one re-check between everything that asks at once', async () => {
      const provider = await licensed();
      const before = keygen.calls.length;

      await Promise.all([
        provider.proLicenseProvider.revalidate!('launch'),
        provider.proLicenseProvider.revalidate!('launch'),
        provider.proLicenseProvider.revalidate!('launch'),
      ]);

      // Several surfaces ask on launch. Three concurrent validations of the same key can race each other's
      // writes, and the last one to land wins for reasons nobody can see.
      expect(keygen.calls.length).toBe(before + 1);
    });

    it('re-checks again once the interval has passed', async () => {
      const provider = await licensed();
      await provider.proLicenseProvider.revalidate!('launch');
      const before = keygen.calls.length;
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(
          Date.now() + PERSONAL_MESH_ENTITLEMENT_REVALIDATION_INTERVAL_MS + 1,
        );

      await provider.proLicenseProvider.revalidate!('peer_connected');

      expect(keygen.calls.length).toBeGreaterThan(before);
    });

    it.each([
      [
        'the fingerprint is missing',
        async ({ service }: { service: string }) =>
          service === 'off-grid-device-fingerprint' ? false : undefined,
      ],
      [
        'the keychain refuses to open',
        async ({ service }: { service: string }) => {
          if (service === 'off-grid-device-fingerprint') {
            throw new Error('the keychain is locked');
          }
          return undefined;
        },
      ],
    ])(
      'leaves the cached answer alone when %s',
      async (_label, fingerprintRead) => {
        const provider = await licensed();
        const stored = new Map(secrets);
        keychain().getGenericPassword.mockImplementation(
          async (options: { service: string }) => {
            const answered = await fingerprintRead(options);
            if (answered !== undefined) return answered;
            const value = stored.get(options.service);
            return value ? { username: 'stored', password: value } : false;
          },
        );

        await provider.proLicenseProvider.revalidate!('launch');

        // No identity to validate against is not evidence of revocation, so the licence stands. Both shapes matter:
        // a locked keychain throws where a missing entry merely answers nothing.
        await expect(
          provider.proLicenseProvider.getInfo(),
        ).resolves.toMatchObject({
          credentialSaved: true,
        });
      },
    );
  });

  describe('the licence being taken away from elsewhere', () => {
    it('clears the credential when another device revokes this one', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await provider.clearProAfterRemoteMembershipRevocation();

      // Removed, not merely deactivated: a revoked device keeping its credential could reactivate itself into a
      // mesh it was deliberately removed from.
      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
      await expect(
        provider.proLicenseProvider.getInfo(),
      ).resolves.toMatchObject({
        credentialSaved: false,
      });
    });

    it('locks Pro before protected storage finishes clearing', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      let finishClear: (() => void) | undefined;
      keychain().resetGenericPassword.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            finishClear = () => resolve(true);
          }),
      );

      const clearing = provider.clearProAfterRemoteMembershipRevocation();
      const { useAppStore } =
        require('../../../src/stores/appStore') as typeof import('../../../src/stores/appStore');
      const { selectHasProAccess } =
        require('../../../src/stores/proAccessSlice') as typeof import('../../../src/stores/proAccessSlice');

      expect(useAppStore.getState().proDeviceAdmission).toBe('inactive');
      expect(selectHasProAccess(useAppStore.getState())).toBe(false);

      finishClear?.();
      await clearing;
      keychain().resetGenericPassword.mockImplementation(
        async ({ service }: { service: string }) => secrets.delete(service),
      );
    });

    it('can be reset for testing without leaving anything behind', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);

      await provider.proLicenseProvider.clearForTesting!();

      await expect(provider.proLicenseProvider.readActive()).resolves.toBe(
        false,
      );
    });
  });

  describe('the devices on the licence', () => {
    it('lists them for the management screen', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });

      const devices = await provider.listProDevices();

      expect(devices.map(({ fingerprint }) => fingerprint).sort()).toEqual([
        'fp-the-mac',
        FINGERPRINT,
      ]);
    });

    it('lists nothing when this phone holds no licence', async () => {
      const provider = load();

      await expect(provider.listProDevices()).resolves.toEqual([]);
      expect(keygen.calls).toEqual([]);
    });

    it('frees a seat when asked', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      const [mac] = keygen
        .machines(LICENCE_KEY)
        .filter(({ fingerprint }) => fingerprint === 'fp-the-mac');

      await expect(provider.deactivateProDevice(mac!.id)).resolves.toBe(true);

      expect(
        keygen.machines(LICENCE_KEY).map(({ fingerprint }) => fingerprint),
      ).toEqual([FINGERPRINT]);
    });

    it('cannot free a seat without a licence', async () => {
      const provider = load();

      await expect(provider.deactivateProDevice('machine-1')).resolves.toBe(
        false,
      );
    });

    it('reports a refusal rather than throwing', async () => {
      const provider = load();
      provider.setDirectEntitlementActivationOwner(activationOwner().owner);
      await provider.proLicenseProvider.activate!(LICENCE_KEY);
      keygen.setOffline(true);

      // The screen shows "could not remove" and the row stays. A throw here would leave the user on a screen
      // that appears broken rather than one that failed an action.
      await expect(provider.deactivateProDevice('machine-1')).resolves.toBe(
        false,
      );
    });
  });
});
