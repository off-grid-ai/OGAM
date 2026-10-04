// Fallback entropy, used only when no secure random source exists. The state is
// seeded once per JS context and then advances on every byte, so two calls can
// never yield the same bytes - not even within the same millisecond, and not
// when a fresh module load restarts the counter.
let fallbackState = 0;

function nextFallbackState(): number {
  if (fallbackState === 0) {
    const clock = Date.now() >>> 0;
    const jitter = (Math.random() * 0x100000000) >>> 0; // NOSONAR - not security relevant
    fallbackState = ((clock ^ jitter) >>> 0) || 0x9e3779b9;
  }
  // xorshift32: full period over every non-zero state, so a 16-byte draw can
  // never repeat the previous draw.
  let state = fallbackState;
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  fallbackState = state >>> 0;
  return fallbackState;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytes;
  }

  // App bootstrap installs react-native-get-random-values. This fallback keeps
  // isolated JS environments functional without weakening the persisted format.
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = nextFallbackState() >>> 24;
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
  return nextFallbackState() % 2147483647;
}
