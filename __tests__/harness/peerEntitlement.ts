import type {
  PairingEntitlementCredential,
  PairingEntitlementHostAdapter,
  PersonalMeshRegistrationInput,
} from '@offgrid/sync';
import {admitPairingEntitlementCredential} from '@offgrid/sync';

/**
 * The OTHER device's entitlement, for tests that need two paired devices.
 *
 * Pairing is a licensed transaction: each side states whether it is licensed, and one of them
 * sponsors the other into the same entitlement. Without that exchange no pair completes at all - the
 * attempt fails with `entitlement_unavailable` - so a harness whose stand-in peer has no entitlement
 * cannot test anything that happens after pairing.
 *
 * This is a fake of a REMOTE DEVICE, which is genuinely outside this process, so it is the right thing
 * to substitute. It really holds a credential, really refuses a second, conflicting entitlement, and
 * really honours prepare/commit/rollback in order - so the exchange either works for the real reason
 * or fails for one.
 *
 * The phone under test always uses its own real adapter, backed by the Keygen fake. Nothing about the
 * device being tested is faked here.
 */
export interface PeerEntitlement extends PairingEntitlementHostAdapter {
  /** What this peer has transacted, so a test can assert the peer's side of it. */
  readonly imported: readonly string[];
  readonly exported: readonly string[];
}

export function createPeerEntitlement(
  options: {
    /** A licensed peer sponsors; an unlicensed one waits to be sponsored. */
    licensed?: boolean;
    entitlementId?: string;
    secret?: string;
    /** Provider-issued installation allowance carried by the peer credential. */
    maxDevices?: number;
  } = {},
): PeerEntitlement {
  const entitlementId = options.entitlementId ?? 'peer-entitlement';
  const secret = options.secret ?? 'peer-entitlement-secret';
  const imported: string[] = [];
  const exported: string[] = [];
  const preparedExports = new Map<string, PersonalMeshRegistrationInput>();
  const preparedImports = new Map<string, PairingEntitlementCredential>();
  let held: PairingEntitlementCredential | undefined = options.licensed
    ? admitPairingEntitlementCredential({
        version: 1,
        entitlementId,
        secret,
        expiresAt: null,
        maxDevices: options.maxDevices ?? 3,
        verifiedAt: 0,
      })
    : undefined;
  let sequence = 0;

  const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

  return {
    imported,
    exported,

    async inspect() {
      return held
        ? { status: 'licensed' as const, entitlementId: held.entitlementId }
        : { status: 'unlicensed' as const };
    },

    async prepareExport(registration) {
      if (!held) throw new Error('this peer has no entitlement to export');
      const id = nextId('export');
      preparedExports.set(id, registration);
      return { id, credential: held };
    },

    async commitExport(preparedId) {
      const registration = preparedExports.get(preparedId);
      if (!registration) throw new Error('that export was not prepared');
      exported.push(registration.syncDeviceId);
    },

    async rollbackExport(preparedId) {
      preparedExports.delete(preparedId);
    },

    async finalizeExport(preparedId) {
      preparedExports.delete(preparedId);
    },

    async prepareImport(credential, registration) {
      // Two devices already carrying different entitlements is the one case that must not merge.
      if (held && held.entitlementId !== credential.entitlementId) {
        throw new Error('this peer already belongs to a different entitlement');
      }
      const id = nextId('import');
      preparedImports.set(id, credential);
      imported.push(registration.syncDeviceId);
      return { id };
    },

    async commitImport(preparedId) {
      const credential = preparedImports.get(preparedId);
      if (!credential) throw new Error('that import was not prepared');
      held = credential;
    },

    async rollbackImport(preparedId) {
      preparedImports.delete(preparedId);
      imported.pop();
    },

    async finalizeImport(preparedId) {
      preparedImports.delete(preparedId);
    },
  };
}
