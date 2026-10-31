let fallbackSequence = 0;

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytes;
  }

  // App bootstrap installs react-native-get-random-values. This fallback keeps
  // isolated JS environments functional without weakening the persisted format.
  fallbackSequence += 1;
  let seed = ((Date.now() >>> 0) ^ fallbackSequence) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; // NOSONAR
    bytes[index] = seed % 256;
  }
  // Time XOR sequence can repeat when the clock ticks between calls, so the sequence
  // itself goes in the last bytes: two fallback ids in one process never match.
  for (let index = 0; index < 4; index += 1) {
    bytes[12 + index] ^= (fallbackSequence >>> (8 * index)) & 0xff;
  }
  return bytes;
}

/** Generate an RFC 4122 version-4 UUID for persisted cross-device identity. */
export function generateId(): string {
  const bytes = randomBytes();
  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/**
 * Generate a random seed for image generation.
 */
export function generateRandomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % 2147483647;
  }
  // Fallback for environments without crypto API
  return Math.floor(
    (((Date.now() * 9301 + 49297) % 233280) / 233280) * 2147483647,
  ); // NOSONAR
}
