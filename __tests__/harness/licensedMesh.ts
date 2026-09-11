import { createKeygenFake, type KeygenFake } from './keygenFake';
import { createPeerEntitlement, type PeerEntitlement } from './peerEntitlement';

/**
 * Two devices that can actually pair.
 *
 * Pairing is a licensed transaction: each side states whether it is licensed, one sponsors the other
 * into the same entitlement, and the sponsored device registers its own installation with the
 * provider. A harness missing any part of that cannot pair at all - the attempt fails with
 * `entitlement_unavailable` or "the new device could not be registered" - so nothing that happens
 * after pairing can be tested.
 *
 * This is the whole arrangement in one place: an in-memory provider at the network boundary, a
 * licence, and a licensed peer holding a credential for it. The phone under test uses its own real
 * adapter, its own credential store and its own registry throughout; only the provider's HTTP endpoint
 * and the other device are substituted, because those are the two things that are genuinely not ours.
 */
export const MESH_LICENCE_KEY = 'OFFGRID-TEST-LICENCE';

export interface LicensedMesh {
  /** The in-memory provider, for asserting what the app asked of it. */
  readonly keygen: KeygenFake;
  /**
   * The provider's id for this licence.
   *
   * Needed by any test that has to write a credential the app will read back, because the app asks the
   * provider for THIS licence's installations by id. Available only after `reset()`.
   */
  readonly licenceId: string;
  /** The installation allowance issued with this fixture's current licence. */
  readonly maxMachines: number;
  /** Installations currently on the licence, as the provider sees them - ids included. */
  installations(): ReturnType<KeygenFake['machines']>;
  /** Start fresh: a clean provider holding one licence with room for three devices. */
  reset(seats?: number): void;
  /** Give the network back. */
  restore(): void;
  /** The other device, licensed and ready to sponsor this one. */
  peer(): PeerEntitlement;
  /**
   * The other device with NO entitlement yet, waiting to be brought onto this licence.
   *
   * The faithful stand-in for a device being paired for the first time: the licensed side sponsors it and
   * registers its installation, which is what puts it on the roster. A licensed peer that was never
   * registered is the one arrangement that cannot happen in life - reconciliation retires a device it
   * finds trusted but absent from the licence, so such a peer pairs and is dropped moments later.
   */
  joiner(device?: { name?: string; platform?: string }): PeerEntitlement;
  /**
   * Put a device on the licence, the way one that has been paired for a while already is.
   *
   * A saved device only appears in the roster if the registry lists an installation for it - the
   * fingerprint IS its sync device id - so a peer that never registered is a peer this phone cannot see,
   * however well the pairing itself went.
   */
  register(device: { id: string; name: string; platform: string }): void;
}

export function createLicensedMesh(): LicensedMesh {
  const keygen = createKeygenFake();
  let licenceId = '';
  let maxMachines = 0;

  return {
    keygen,

    get licenceId() {
      return licenceId;
    },

    get maxMachines() {
      return maxMachines;
    },

    installations() {
      return keygen.machines(MESH_LICENCE_KEY);
    },

    reset(seats = 3) {
      keygen.reset();
      keygen.install();
      maxMachines = seats;
      licenceId = keygen.addLicence({ key: MESH_LICENCE_KEY, seats });
    },

    restore() {
      keygen.restore();
    },

    register(device) {
      keygen.activate({
        key: MESH_LICENCE_KEY,
        fingerprint: device.id,
        name: device.name,
        platform: device.platform,
      });
    },

    peer() {
      // The credential names the provider's licence, because that is what the receiving device will
      // register its installation against.
      return createPeerEntitlement({
        licensed: true,
        entitlementId: licenceId,
        secret: MESH_LICENCE_KEY,
      });
    },

    joiner(device) {
      const peer = createPeerEntitlement({
        licensed: false,
        entitlementId: licenceId,
        secret: MESH_LICENCE_KEY,
      });
      const commitImport = peer.commitImport.bind(peer);
      return Object.assign(peer, {
        async commitImport(preparedId: string): Promise<void> {
          await commitImport(preparedId);
          // A device brought onto a licence registers its OWN installation - the sponsor only makes room.
          // Leaving that out is what made a newly paired peer vanish: reconciliation found it trusted
          // but absent from the roster and retired it, seconds after a pairing that had gone perfectly.
          const syncDeviceId = peer.imported[peer.imported.length - 1];
          if (syncDeviceId) {
            keygen.activate({
              key: MESH_LICENCE_KEY,
              fingerprint: syncDeviceId,
              name: device?.name ?? syncDeviceId,
              platform: device?.platform ?? 'macos',
            });
          }
        },
      });
    },
  };
}

/**
 * A phone that holds a Pro licence, with a Keychain that really stores things.
 *
 * Several journey suites need the same three facts before anything else can work: a licence credential
 * naming the provider's licence, a stable device fingerprint, and a Keychain that remembers what was
 * written to it. Without the credential the phone cannot ask for the installation roster, so the mesh
 * reports `freshness: 'unavailable'` and the saved-device list is empty - a paired device then completes
 * pairing successfully and appears nowhere, which looks like a pairing bug and is not one.
 *
 * Returns the secret store so a test can seed or inspect it - and so a "restart" can reuse it, which is
 * what makes a credential outlive a service stop.
 */
export function installLicensedPhone(
  mesh: LicensedMesh,
  options: {
    fingerprint?: string;
    secrets?: Map<string, string>;
    /**
     * Called before a write lands, so a test can make the Keychain refuse one.
     *
     * Throwing here is how a suite exercises "the credential could not be saved" without replacing the
     * whole store and losing the licence with it.
     */
    beforeWrite?: (service: string) => void;
  } = {},
): Map<string, string> {
  const keychain = require('react-native-keychain');
  const secrets = options.secrets ?? new Map<string, string>();
  // One Keychain entry carries two readings of the same credential: the licence client reads
  // `licenseId`, and the pairing-entitlement authority reads `entitlementId`. Both name the same licence.
  // Omitting the second one is not a smaller lie: without it the phone cannot SPONSOR another device, so
  // a first-time pairing never registers the new device and it is retired at the next reconciliation.
  secrets.set(
    'off-grid-pro-license',
    JSON.stringify({
      isPro: true,
      key: MESH_LICENCE_KEY,
      licenseId: mesh.licenceId,
      entitlementId: mesh.licenceId,
      expiry: null,
      maxMachines: mesh.maxMachines,
      tier: 'lifetime',
      verifiedAt: 0,
    }),
  );
  secrets.set(
    'off-grid-device-fingerprint',
    options.fingerprint ?? 'fp-this-phone',
  );
  keychain.getGenericPassword.mockImplementation(
    async ({ service }: { service: string }) => {
      const value = secrets.get(service);
      return value ? { username: 'stored', password: value } : false;
    },
  );
  keychain.setGenericPassword.mockImplementation(
    async (_username: string, password: string, opts: { service: string }) => {
      options.beforeWrite?.(opts.service);
      secrets.set(opts.service, password);
      return true;
    },
  );
  keychain.resetGenericPassword?.mockImplementation?.(
    async ({ service }: { service: string }) => secrets.delete(service),
  );
  return secrets;
}

/**
 * Put THIS phone on the licence, under the fingerprint it actually has.
 *
 * The fingerprint is generated once and cached for the lifetime of the module, so a suite cannot decide
 * what it will be - by the second test in a file it is whatever the first test caused to be minted. A
 * harness that registers a fingerprint of its own choosing therefore registers a device that is not this
 * one: validation answers NO_MACHINE, Pro switches itself off, and every screen behind it goes quiet for
 * a reason that looks nothing like the cause.
 *
 * So the phone is asked what it is, and that is what gets registered.
 */
export async function registerThisPhone(
  mesh: LicensedMesh,
  device: { name?: string; platform?: string } = {},
): Promise<string> {
  const { getDeviceFingerprint } =
    require('../../pro/licensing/deviceFingerprint') as {
      getDeviceFingerprint: () => Promise<string>;
    };
  const fingerprint = await getDeviceFingerprint();
  mesh.register({
    id: fingerprint,
    name: device.name ?? 'This phone',
    platform: device.platform ?? 'ios',
  });
  return fingerprint;
}
