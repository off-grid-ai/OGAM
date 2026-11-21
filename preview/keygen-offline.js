// The preview's licence server client: always offline. The preview never sends a licence key anywhere, and
// the app treats "offline" as "keep the saved licence", so the Pro licence in keychain.js holds. Same
// exports as pro/licensing/keygenClient.ts.
export class KeygenNetworkError extends Error {}

const offline = async () => {
  throw new KeygenNetworkError('The translation preview is offline.');
};

export function keygenLicenseTier(license) {
  const tier = license.metadata && license.metadata.tier;
  if (tier === 'lifetime' || tier === 'monthly' || tier === 'annual') return tier;
  return license.expiry ? null : 'lifetime';
}

export const validateKey = offline;
export const activateMachine = offline;
export const listMachines = offline;
export const deactivateMachine = offline;
export const updateMachine = offline;
