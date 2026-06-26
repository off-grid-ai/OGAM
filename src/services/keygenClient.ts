/**
 * Low-level Keygen REST client.
 *
 * Wraps the validate-key, machine activate/deactivate, and list-machines
 * endpoints. The license KEY is the credential (policies are unprotected with a
 * MIXED authentication strategy), so machine actions authenticate with
 * `Authorization: License <key>` and validate-key needs no auth at all.
 *
 * Transport failures throw KeygenNetworkError so the service layer can fall back
 * to the cached license (offline grace) instead of locking the user out.
 */
import { KEYGEN_API_BASE, KEYGEN_PRODUCT_ID } from '../config/keygen';
import logger from '../utils/logger';

const JSON_API = 'application/vnd.api+json';

export type ValidationCode =
  | 'VALID'
  | 'NO_MACHINE'
  | 'NO_MACHINES'
  | 'TOO_MANY_MACHINES'
  | 'FINGERPRINT_SCOPE_MISMATCH'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'BANNED'
  | 'OVERDUE'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface KeygenLicense {
  id: string;
  expiry: string | null; // ISO timestamp, or null for a perpetual (lifetime) key
  metadata: Record<string, unknown>;
  name: string | null;
}

export interface ValidateResult {
  valid: boolean;
  code: ValidationCode;
  license: KeygenLicense | null;
}

export interface KeygenMachine {
  id: string;
  fingerprint: string;
  platform: string | null;
  name: string | null;
  lastSeen: string | null;
}

/** Raised on a network/transport failure (offline), never on a 4xx from Keygen. */
export class KeygenNetworkError extends Error {}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${KEYGEN_API_BASE}${path}`, init);
  } catch (e) {
    throw new KeygenNetworkError(e instanceof Error ? e.message : String(e));
  }
}

function toLicense(data: any): KeygenLicense | null {
  if (!data || !data.id) return null;
  return {
    id: data.id,
    expiry: data.attributes?.expiry ?? null,
    metadata: data.attributes?.metadata ?? {},
    name: data.attributes?.name ?? null,
  };
}

/** Validate a key, scoped to this product + device fingerprint. No auth needed. */
export async function validateKey(key: string, fingerprint: string): Promise<ValidateResult> {
  const res = await request('/licenses/actions/validate-key', {
    method: 'POST',
    headers: { 'Content-Type': JSON_API, Accept: JSON_API },
    body: JSON.stringify({
      meta: { key, scope: { product: KEYGEN_PRODUCT_ID, fingerprint } },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  return {
    valid: !!body?.meta?.valid,
    code: (body?.meta?.code ?? 'UNKNOWN') as ValidationCode,
    license: toLicense(body?.data),
  };
}

/** Register this device as a machine on the license. Enforces the device cap. */
export async function activateMachine(
  key: string,
  licenseId: string,
  device: { fingerprint: string; platform: string },
): Promise<{ ok: boolean; limitReached: boolean }> {
  const { fingerprint, platform } = device;
  const res = await request('/machines', {
    method: 'POST',
    headers: { 'Content-Type': JSON_API, Accept: JSON_API, Authorization: `License ${key}` },
    body: JSON.stringify({
      data: {
        type: 'machines',
        attributes: { fingerprint, platform, metadata: { platform } },
        relationships: { license: { data: { type: 'licenses', id: licenseId } } },
      },
    }),
  });
  if (res.status === 201) return { ok: true, limitReached: false };
  const body: any = await res.json().catch(() => ({}));
  const errors: any[] = body?.errors ?? [];
  // Keygen returns 422 with a MACHINE_LIMIT_EXCEEDED code when over the cap.
  const limitReached =
    res.status === 422 &&
    errors.some(
      (e) =>
        String(e?.code ?? '').includes('LIMIT') ||
        String(e?.detail ?? '').toLowerCase().includes('machine limit'),
    );
  if (!limitReached) {
    logger.error(`[Keygen] activate failed (${res.status}): ${JSON.stringify(errors)}`);
  }
  return { ok: false, limitReached };
}

/** List the machines currently activated on a license. */
export async function listMachines(key: string, licenseId: string): Promise<KeygenMachine[]> {
  const res = await request(`/licenses/${licenseId}/machines`, {
    method: 'GET',
    headers: { Accept: JSON_API, Authorization: `License ${key}` },
  });
  const body: any = await res.json().catch(() => ({}));
  const data: any[] = body?.data ?? [];
  return data.map((m) => ({
    id: m.id,
    fingerprint: m.attributes?.fingerprint ?? '',
    platform: m.attributes?.platform ?? null,
    name: m.attributes?.name ?? null,
    lastSeen: m.attributes?.lastHeartbeat ?? m.attributes?.created ?? null,
  }));
}

/** Free a device slot. */
export async function deactivateMachine(key: string, machineId: string): Promise<boolean> {
  const res = await request(`/machines/${machineId}`, {
    method: 'DELETE',
    headers: { Accept: JSON_API, Authorization: `License ${key}` },
  });
  return res.status === 204 || res.ok;
}
