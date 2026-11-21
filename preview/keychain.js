// The preview's keychain: a browser has none, so this keeps entries in memory for the page's life, and it
// starts holding a Pro licence. The app reads that licence the way a paid phone does, so the Pro screens
// are there to translate in a release build. The licence works only in this preview: it never reaches a
// licence server, and the preview saves nothing.
const PRO_SERVICE = 'off-grid-pro-license';

const entries = new Map([
  [
    PRO_SERVICE,
    {
      username: 'pro',
      password: JSON.stringify({
        isPro: true,
        key: 'TRANSLATION-PREVIEW',
        licenseId: 'translation-preview',
        expiry: null,
        maxMachines: 1,
        tier: 'lifetime',
        verifiedAt: Date.now(),
      }),
    },
  ],
]);

const serviceOf = options => (options && options.service) || 'default';

export const ACCESSIBLE = {
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
};
export const ACCESS_CONTROL = {};
export const SECURITY_LEVEL = {};
export const STORAGE_TYPE = {};

export async function getGenericPassword(options) {
  const entry = entries.get(serviceOf(options));
  return entry ? { service: serviceOf(options), ...entry } : false;
}

export async function setGenericPassword(username, password, options) {
  entries.set(serviceOf(options), { username, password });
  return { service: serviceOf(options), storage: 'memory' };
}

export async function resetGenericPassword(options) {
  return entries.delete(serviceOf(options));
}

export default {
  ACCESSIBLE,
  ACCESS_CONTROL,
  SECURITY_LEVEL,
  STORAGE_TYPE,
  getGenericPassword,
  setGenericPassword,
  resetGenericPassword,
};
