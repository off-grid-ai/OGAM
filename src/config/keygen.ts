/**
 * Keygen licensing config.
 *
 * Every value here is NON-secret:
 *  - the Ed25519 public key is a verification key (public by design),
 *  - the account / product / policy IDs are plain identifiers.
 *
 * The secret Keygen API token is used only server-side (the issuance Lambda and
 * the one-time migration script). It must never live in the app or this repo.
 */

export const KEYGEN_ACCOUNT_ID = 'c23ac6be-7ca9-4ef2-b0a6-06b751511bc1';
export const KEYGEN_PRODUCT_ID = '1fa22f37-eb8f-40fb-b37e-fcf82e342da1';

// Account Ed25519 public key (hex). Used to verify signed license keys offline.
export const KEYGEN_PUBLIC_KEY =
  'c848992ce20aa4822264318ad19ea1c5ca60345a7b603b9317a478d1b5720d8e';

// Policy IDs (informational on the app side; the Lambda picks the policy at
// issuance). Kept here so the app can tell lifetime from monthly if needed.
export const KEYGEN_POLICY_LIFETIME = '54c17e72-6d6c-4813-b656-6dda8a3a155a';
export const KEYGEN_POLICY_MONTHLY = '5037f53b-09ba-4d9f-b1ad-52830d612ee0';

export const KEYGEN_API_BASE = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}`;
