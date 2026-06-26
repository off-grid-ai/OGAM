# Off Grid Pro - Licensing Plan

## What it is

Off Grid Pro uses a license-key model: no login, no accounts, offline-first.
RevenueCat handles the money (checkout + payment events, as it does today).
Keygen handles licensing (keys, device limits, offline validation). A thin
Lambda connects the two. The app validates a signed key offline and never talks
to RevenueCat.

## The model

| Tier | Price | Key type | Expiry | Renewal |
|---|---|---|---|---|
| Lifetime Pro | $50 one-time | perpetual | never | none |
| Monthly Pro | $39 / month | timed | period end + buffer | each cycle |

Both run through one Keygen integration. The only difference is the expiry baked
into the key and whether renewals fire.

## The pieces

1. **RevenueCat - payments.** The existing pay page and payment backend. On a
   successful payment it fires a webhook with the buyer's email and product. No
   change to how money is taken.
2. **Lambda - the bridge (stateless, no database).** Receives RevenueCat
   webhooks, calls Keygen to create or renew the license, and emails the key.
3. **Keygen Cloud - licensing.** Issues cryptographically signed keys with tier
   and expiry embedded; enforces the device cap; serves offline validation, the
   check-in, and the grace window.
4. **The app - offline validation.** Verifies the signed key locally against a
   baked-in public key; activates once per device; re-checks periodically to
   catch renewal and revocation.

## Keygen configuration

- **Two policies:** `pro-lifetime` (perpetual, no expiry) and `pro-monthly`
  (timed, 1 month plus a short buffer).
- Both: **floating, `maxMachines = 5`** (shared across iOS, Android, and Off Grid
  Desktop), **Ed25519** signed, machine activation required before validation.
- **License file (cert) TTL ~9 days** - the offline-snapshot freshness, separate
  from the subscription expiry.
- Secret key lives server-side (Lambda + migration script). The app holds only
  the public key.

## The Lambda (issuance + renewal)

Stateless, idempotent (RevenueCat retries on), keyed on the event id and email.

| RevenueCat event | Keygen action |
|---|---|
| `INITIAL_PURCHASE` / `NON_RENEWING_PURCHASE` (lifetime) | create a **perpetual** license, set `metadata.email`, email the key |
| `INITIAL_PURCHASE` (monthly) | create a **timed** license (expiry = period end + buffer), set `metadata.email`, email the key |
| `RENEWAL` (monthly, each cycle) | push the license expiry forward, proactively |
| `CANCELLATION` / `EXPIRATION` (monthly) | let it lapse at period end (or suspend) |

The email comes from the event (`$email`). Sending the key needs an email
provider (SES, Resend, Postmark, etc.).

## The app

- **First run on a device:** one online **activation** claims one of the 5
  machine slots. The fingerprint is a random UUID generated once and persisted
  in the Keychain, so a reinstall reclaims its slot. Tag the machine with
  `metadata.platform = ios | android | desktop`.
- **Every launch:** verify the signed key locally against the baked-in public
  key, read tier and expiry, check expiry against the device clock. Fully
  offline.
- **Every 7 days:** check in with Keygen to refresh the cert, pick up a renewed
  expiry, and catch revocation. If the check-in fails, keep working **2 more
  days** (grace, inside the 9-day TTL), then lock.
- **Seat-management screen:** list the device's machines (N of 5) and let the
  user deactivate one. A 5-cap on a perpetual key fills over years of device
  upgrades, so a lifetime buyer must always be able to free a slot.

## The monthly expiry rule (the one risk)

A monthly key expires monthly, so the renewal must reach Keygen before the key
expires or a paying user hits the grace and then locks out. Applied together:

1. **Buffer the expiry**: license expiry = billing period end + a few days, so
   the offline key outlives the period enough to absorb webhook and check-in lag.
2. **Renew proactively** on `RENEWAL` (push expiry forward immediately).
3. Idempotent Lambda + RevenueCat retries.
4. A manual reissue/extend support path for the rare miss.

Lifetime has none of this risk - the key never expires.

## Migration (existing cohort + cutover)

**Backfill (one-time script, same Keygen calls as the Lambda in a loop):**

1. Export the current Pro customers from RevenueCat (dashboard export or REST
   API): email, tier, status.
2. For each: create a Keygen license - **perpetual** for lifetime/pre-order
   buyers, **timed** for any monthly - set `metadata.email`, email the key.
3. Idempotent: skip anyone who already has a license with that `metadata.email`.

**Cutover (do not strand anyone):**

- The new app build validates the Keygen key.
- Keep the current in-app entitlement check working as a **fallback for a 60-90
  day window** so users keep Pro between getting the email and entering the key.
  Lifetime buyers especially must not lose access in the gap.
- Migration email: "we moved to license keys, here is yours, update the app and
  paste it in."
- Remove the fallback after the window.

## Analytics (email and platform)

Both live in Keygen:

- **email - key:** `metadata.email` on each license at issuance. Keygen is the
  customer lookup; no separate database.
- **desktop / mobile / both:** `metadata.platform` on each machine at activation.
  A small reporting script reads the Keygen API and counts desktop-only vs
  mobile-only vs both. Optionally pipe Keygen webhooks into a sheet for a live
  view.

## Cost

- Keygen Cloud Std 1: $99/mo flat (up to 1,000 active licensed users; ~16% off
  annual).
- RevenueCat + Stripe: their normal per-transaction cut.
- Lambda: negligible.
- No database, no servers maintained.

## Honest limits

- Offline validation is defeatable by a determined cracker (spoof a fingerprint,
  patch the verify call) - true of any client-side licensing. It stops casual
  key-sharing cold, because new devices must come online to activate and the
  5-cap holds there.
- Device fingerprints go to Keygen Cloud (a third party): anti-piracy metadata
  (a hashed fingerprint + activation timestamps), never user data, touched once
  per device.
- Monthly renewal reliability is load-bearing for the monthly tier (see the
  expiry rule). Lifetime is unaffected.

## Build plan

- **Phase 0 - Keygen setup:** account, two policies, `maxMachines = 5`, Ed25519,
  ~9-day TTL. Capture public key (app) + secret key (server).
- **Phase 1 - Lambda:** RevenueCat webhook endpoint, the event mapping above,
  email delivery, idempotency, expiry buffer + proactive renewal.
- **Phase 2 - App:** offline verify module, activation with the Keychain-UUID
  fingerprint + platform tag, 7-day check-in / 2-day grace, seat-management
  screen.
- **Phase 3 - Migration + cutover:** backfill script, migration email, the
  60-90 day fallback window, then removal.
- **Phase 4 - Analytics + ops:** reporting script, manual reissue path, webhook
  delivery monitoring.

## References

- Keygen floating licenses: https://keygen.sh/docs/choosing-a-licensing-model/floating-licenses/
- Keygen offline licensing: https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/
- Keygen cryptography: https://keygen.sh/docs/api/cryptography/
- Keygen activating machines: https://keygen.sh/docs/activating-machines/
- RevenueCat webhooks: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
