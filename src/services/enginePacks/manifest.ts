import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';

/**
 * The signed list of Android llama.cpp engine packs that off-grid-ai/llama.rn publishes with each
 * release (its README, "Android engine packs"). One pack per ABI: the full librnllama*.so set,
 * built for one React Native version and one Java/JS bridge. The manifest is trusted only when its
 * ed25519 signature matches the key the app pins; each pack is then pinned by the sha256 of its
 * zip and of every file inside it.
 */

/** One pack, as the app hands it to the native store (EnginePackStore). */
export interface EnginePack {
  /** The @ogai/llama.rn version the pack was built from. */
  engineVersion: string;
  /** llama.cpp build number inside the pack: what catalog `minLlamaBuild` compares. */
  llamaBuild: number;
  /** Exact React Native version the JNI wrappers were built against. */
  reactNative: string;
  /** Hash of the Java/JS contract the pack expects the app to carry. */
  bridge: string;
  abi: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Path inside the pack → sha256, for every file the pack holds and nothing else. */
  files: Record<string, string>;
}

// The fork's npm name, and the name its first signed manifests carry.
const PACKAGES = ['@ogai/llama.rn', '@offgrid/llama.rn'];
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9._-]+$/;
const FILE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

/** Hosts a pack may come from: the signature is the trust, this keeps a signed typo from fetching elsewhere. */
const PACK_HOSTS = ['mobile-runtime.getoffgridai.co', 'github.com'];

interface RawPack {
  abi?: unknown;
  url?: unknown;
  sha256?: unknown;
  size?: unknown;
  files?: Array<{ path?: unknown; sha256?: unknown }>;
}

interface RawManifest {
  schema?: unknown;
  package?: unknown;
  version?: unknown;
  llamaBuild?: unknown;
  bridge?: unknown;
  reactNative?: unknown;
  packs?: unknown;
}

function hostAllowed(url: unknown): boolean {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && PACK_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function toPack(raw: RawPack | null, top: Omit<EnginePack, 'abi' | 'url' | 'sha256' | 'bytes' | 'files'>): EnginePack | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.files)) return null;
  const files = raw.files.map(f => [f?.path, f?.sha256] as const);
  const valid =
    typeof raw.abi === 'string' &&
    hostAllowed(raw.url) &&
    typeof raw.sha256 === 'string' && SHA256.test(raw.sha256) &&
    Number.isSafeInteger(raw.size) && (raw.size as number) > 0 &&
    files.some(([path]) => path === 'librnllama.so') &&
    files.every(([path, hash]) => typeof path === 'string' && FILE.test(path) && typeof hash === 'string' && SHA256.test(hash));
  if (!valid) return null;
  return {
    ...top,
    abi: raw.abi as string,
    url: raw.url as string,
    sha256: raw.sha256 as string,
    bytes: raw.size as number,
    files: Object.fromEntries(files) as Record<string, string>,
  };
}

/**
 * The packs of a manifest whose signature verifies against `publicKeyBase64`. Throws when the
 * signature does not match or the manifest is not a schema 1 llama.rn fork manifest; drops any
 * pack that is malformed.
 */
export function verifyManifest(body: string, signatureBase64: string, publicKeyBase64: string): EnginePack[] {
  let valid = false;
  try {
    valid = nacl.sign.detached.verify(decodeUTF8(body), decodeBase64(signatureBase64.trim()), decodeBase64(publicKeyBase64));
  } catch {
    valid = false;
  }
  if (!valid) throw new Error('Engine pack manifest signature does not match');
  const m = JSON.parse(body) as RawManifest;
  const top =
    m.schema === 1 &&
    PACKAGES.includes(String(m.package)) &&
    typeof m.version === 'string' && VERSION.test(m.version) &&
    Number.isSafeInteger(m.llamaBuild) && (m.llamaBuild as number) > 0 &&
    typeof m.bridge === 'string' && typeof m.reactNative === 'string' &&
    Array.isArray(m.packs);
  if (!top) throw new Error('Engine pack manifest is not a schema 1 llama.rn fork manifest');
  const shared = {
    engineVersion: m.version as string,
    llamaBuild: m.llamaBuild as number,
    reactNative: m.reactNative as string,
    bridge: m.bridge as string,
  };
  return (m.packs as RawPack[]).flatMap(raw => toPack(raw, shared) ?? []);
}

/** A pack's folder name in the native store (EnginePackStore.packId): version + first 12 hex of the zip hash. */
export function packId(pack: Pick<EnginePack, 'engineVersion' | 'sha256'>): string {
  return `${pack.engineVersion}-${pack.sha256.slice(0, 12)}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * The newest pack this app build can load that carries a newer llama.cpp than the one it runs, or
 * null. A pack must match the app's React Native version and bridge exactly and the phone's ABI,
 * and never be one the phone rejected before.
 */
export function choosePack(
  packs: readonly EnginePack[],
  device: { reactNative: string; bridge: string; abis: readonly string[]; currentBuild: number; rejected: ReadonlySet<string> },
): EnginePack | null {
  // An app that does not know its bridge (an older package) takes no pack.
  if (!device.bridge) return null;
  const fits = packs.filter(
    p =>
      p.reactNative === device.reactNative &&
      p.bridge === device.bridge &&
      device.abis.includes(p.abi) &&
      p.llamaBuild > device.currentBuild &&
      !device.rejected.has(packId(p)),
  );
  return fits.reduce<EnginePack | null>((best, p) => (best && best.llamaBuild >= p.llamaBuild ? best : p), null);
}
