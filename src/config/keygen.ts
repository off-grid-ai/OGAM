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

const KEYGEN_ACCOUNT_ID = 'c23ac6be-7ca9-4ef2-b0a6-06b751511bc1';
export const KEYGEN_PRODUCT_ID = '1fa22f37-eb8f-40fb-b37e-fcf82e342da1';

export const KEYGEN_API_BASE = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}`;
