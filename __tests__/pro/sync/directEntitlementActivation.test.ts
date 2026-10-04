import {
  PersonalMeshEntitlementError,
  type PersonalMeshInstallation,
  type PersonalMeshMembershipReplacementAdapter,
  type PersonalMeshRegistrationInput,
} from '@offgrid/sync';
import { createDirectEntitlementActivationOwner } from '../../../pro/sync/directEntitlementActivation';
import {validateKey} from '../../../pro/licensing/keygenClient';
import {
  MESH_LICENCE_KEY,
  createLicensedMesh,
  installLicensedPhone,
  type LicensedMesh,
} from '../../harness/licensedMesh';

/**
 * Entering a licence key on this phone.
 *
 * The user paid, typed the key, and expects this device to be on the licence when the sheet closes. What
 * makes that safe is that it is a TRANSACTION: the phone takes a seat, the credential is written, and only
 * then is the old membership it may have displaced actually retired. If any step fails, everything before it
 * is undone - a phone that took a seat but failed to save its credential must not leave that seat consumed,
 * because the user has then paid for a licence with a seat held by nothing.
 *
 * The licence stack runs for real: the coordinator, the Keygen registry, the client. Only the provider's
 * HTTP endpoint is substituted, by a fake that really holds installations and really enforces the seat
 * limit - so what a test asserts about the licence is emergent, not arranged.
 */
describe('entering a licence key on this phone', () => {
  let mesh: LicensedMesh;
  let maxMachines: number;

  /** The membership this phone would displace, as durable state a rollback must be able to undo. */
  class MembershipReplacements
    implements PersonalMeshMembershipReplacementAdapter<string>
  {
    readonly prepared: string[] = [];
    readonly committed: string[] = [];
    readonly rolledBack: string[] = [];
    readonly finalized: string[] = [];
    private next = 0;

    async prepareEviction(installation: PersonalMeshInstallation) {
      this.next += 1;
      const token = `eviction-${this.next}`;
      this.prepared.push(installation.syncDeviceId);
      return token;
    }

    async commitEviction(token: string) {
      this.committed.push(token);
    }

    async rollbackEviction(token: string) {
      this.rolledBack.push(token);
    }

    async finalizeEviction(token: string) {
      this.finalized.push(token);
    }
  }

  const localDevice: PersonalMeshRegistrationInput = {
    syncDeviceId: 'fp-this-phone',
    deviceName: 'This phone',
    platform: 'ios',
  };

  const owner = (
    membership: MembershipReplacements,
    onRegistryChanged?: () => void | Promise<void>,
  ) =>
    createDirectEntitlementActivationOwner({
      localDevice,
      membership,
      onRegistryChanged,
    });

  const activation = (fingerprint: string) => ({
    key: MESH_LICENCE_KEY,
    entitlementId: mesh.licenceId,
    expiresAt: null,
    maxMachines,
    fingerprint,
  });

  /** The fingerprint the phone actually has - it is minted once per module and cannot be chosen. */
  const thisPhone = async (): Promise<string> => {
    const { getDeviceFingerprint } =
      require('../../../pro/licensing/deviceFingerprint') as {
        getDeviceFingerprint: () => Promise<string>;
      };
    return getDeviceFingerprint();
  };

  /**
   * A licence with no room left, the oldest device first.
   *
   * The cap is the mesh's own, not the provider's seat count, so "full" means as many installations as the
   * mesh allows - that is the state in which activating this phone has to displace something.
   */
  const fullLicence = (): void => {
    mesh.reset(maxMachines);
    installLicensedPhone(mesh);
    mesh.register({
      id: 'fp-the-old-phone',
      name: 'Old phone',
      platform: 'ios',
    });
    for (let index = 1; index < maxMachines; index += 1) {
      mesh.register({
        id: `fp-device-${index}`,
        name: `Device ${index}`,
        platform: 'macos',
      });
    }
  };

  beforeEach(async () => {
    mesh = createLicensedMesh();
    mesh.reset();
    installLicensedPhone(mesh);
    const validation = await validateKey(MESH_LICENCE_KEY, await thisPhone());
    if (!validation.license?.maxMachines) {
      throw new Error('The licensed-mesh fixture returned no machine limit.');
    }
    maxMachines = validation.license.maxMachines;
  });

  afterEach(() => {
    mesh.restore();
  });

  it('puts this phone on the licence', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const fingerprint = await thisPhone();

    const transaction = await activating.prepareDirectActivation(
      activation(fingerprint),
    );
    await activating.commitDirectActivation(transaction);
    await activating.finalizeDirectActivation(transaction);

    // The provider is the authority on who holds a seat, so that is what is read: this phone, by the
    // fingerprint it actually has.
    expect(mesh.installations().map(({ fingerprint: held }) => held)).toContain(
      fingerprint,
    );
  });

  it('takes the seat during prepare, so a full licence is discovered before anything is written', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);

    await activating.prepareDirectActivation(activation(await thisPhone()));

    // Registered by the end of prepare: the caller writes the credential next, and finding out then that
    // there was no room would leave a paid licence with a phone that believes it is licensed.
    expect(mesh.installations()).toHaveLength(1);
  });

  it('gives back the seat when the credential could not be saved', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    expect(mesh.installations()).toHaveLength(1);

    // What the caller does when the Keychain write fails.
    await activating.rollbackDirectActivation(transaction);

    // The seat is free again. Leaving it consumed is a licence the user paid for with a seat held by
    // nothing, and no screen on any device from which to free it.
    expect(mesh.installations()).toHaveLength(0);
  });

  it('makes room by displacing a membership, and only retires it at the end', async () => {
    fullLicence();
    const membership = new MembershipReplacements();
    const activating = owner(membership);

    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );

    // Chosen, but not yet retired: until the credential is safely written this activation can still be
    // undone, and the old device must come back rather than having been told it was revoked.
    expect(membership.prepared).toEqual(['fp-the-old-phone']);
    expect(membership.finalized).toEqual([]);

    await activating.commitDirectActivation(transaction);
    expect(membership.committed).toHaveLength(1);
    // Still not retired at commit: commit only makes the replacement durable.
    expect(membership.finalized).toEqual([]);

    await activating.finalizeDirectActivation(transaction);
    expect(membership.finalized).toHaveLength(1);
  });

  it('brings the displaced membership back when the activation is undone', async () => {
    fullLicence();
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );

    await activating.rollbackDirectActivation(transaction);

    // The old phone keeps its membership: a failed activation that revoked it anyway would take a working
    // device off the mesh in exchange for nothing.
    expect(membership.rolledBack).toHaveLength(1);
    expect(membership.finalized).toEqual([]);
  });

  it('tells whoever is watching that the licence changed, once it is really done', async () => {
    const membership = new MembershipReplacements();
    const changes: string[] = [];
    const activating = owner(membership, () => {
      changes.push('reconciled');
    });
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    await activating.commitDirectActivation(transaction);
    expect(changes).toEqual([]);

    await activating.finalizeDirectActivation(transaction);

    // Only at the end: the Devices screen redraws off this, and redrawing mid-transaction would show a
    // roster that is about to be rolled back.
    expect(changes).toEqual(['reconciled']);
  });

  it('waits for the watcher before reporting the activation done', async () => {
    const membership = new MembershipReplacements();
    let released: (() => void) | undefined;
    const activating = owner(
      membership,
      () =>
        new Promise<void>(resolve => {
          released = resolve;
        }),
    );
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    await activating.commitDirectActivation(transaction);

    let finished = false;
    const finalizing = activating
      .finalizeDirectActivation(transaction)
      .then(() => {
        finished = true;
      });
    await Promise.resolve();
    expect(finished).toBe(false);

    released?.();
    await finalizing;
    // Awaited, so the sheet closes onto a screen that already knows this phone is licensed rather than one
    // that still says it is not.
    expect(finished).toBe(true);
  });

  it.each([
    ['committing', (o: ReturnType<typeof owner>) => o.commitDirectActivation],
    ['finalizing', (o: ReturnType<typeof owner>) => o.finalizeDirectActivation],
  ])(
    'refuses %s an activation it knows nothing about',
    async (_label, pick) => {
      const activating = owner(new MembershipReplacements());

      // Loud, and with the code the caller maps to a reason: a transaction that was never prepared means the
      // seat was never taken, so carrying on would write a credential for a licence this phone is not on.
      await expect(pick(activating)('never-prepared')).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
    },
  );

  it('is happy to undo an activation that never started', async () => {
    const activating = owner(new MembershipReplacements());

    // Rollback runs on the failure path, and the failure may have happened before prepare returned. A throw
    // here would replace the real reason with a bookkeeping one.
    await expect(
      activating.rollbackDirectActivation('never-prepared'),
    ).resolves.toBeUndefined();
  });

  it('forgets a transaction once it is undone', async () => {
    fullLicence();
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    await activating.rollbackDirectActivation(transaction);

    await activating.rollbackDirectActivation(transaction);

    // Rolled back once, not twice: a second rollback of the same replacement would restore a membership
    // that has since been legitimately replaced by another activation.
    expect(membership.rolledBack).toHaveLength(1);
  });

  it('forgets a transaction once it is finished', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const transaction = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    await activating.commitDirectActivation(transaction);
    await activating.finalizeDirectActivation(transaction);

    // A retry of a finished activation is a no-op that must not look successful, or a caller could finalize
    // the same replacement twice and revoke a second device.
    await expect(
      activating.finalizeDirectActivation(transaction),
    ).rejects.toThrow(PersonalMeshEntitlementError);
  });

  it('keeps two activations apart', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);

    const first = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );
    const second = await activating.prepareDirectActivation(
      activation(await thisPhone()),
    );

    expect(first).not.toBe(second);
    // Undoing one leaves the other still finishable - a retry after a failed attempt must not be broken by
    // the attempt it replaced.
    await activating.rollbackDirectActivation(first);
    await expect(
      activating.commitDirectActivation(second),
    ).resolves.toBeUndefined();
  });

  it('does not claim a seat it could not reach the provider for', async () => {
    const membership = new MembershipReplacements();
    const activating = owner(membership);
    const fingerprint = await thisPhone();
    mesh.keygen.setOffline(true);

    await expect(
      activating.prepareDirectActivation(activation(fingerprint)),
    ).rejects.toBeDefined();

    // Nothing prepared and nothing to undo: the caller reports "could not reach the licence" and the user
    // tries again, rather than the phone believing it is licensed while the provider has never heard of it.
    mesh.keygen.setOffline(false);
    expect(mesh.installations()).toHaveLength(0);
    expect(membership.prepared).toEqual([]);
  });
});
