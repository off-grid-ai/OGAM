# Off Grid Pro licensing — retired

**Status: retired. There is nothing to purchase.**

Off Grid AI no longer has a paid tier. Every capability the app has — voice mode and on-device speech,
custom personas, draft-then-approve actions, MCP tools, and Personal Mesh sync — is free for everyone, in
every build. There is no price, no checkout, no licence key, and nothing that expires.

## What this document used to describe

The licensing system was a three-part machine:

1. **RevenueCat** took the money and fired a webhook on payment, renewal and cancellation.
2. **A stateless Lambda** turned those webhooks into Keygen licence creations and renewals, and emailed
   the key to the buyer.
3. **Keygen** issued Ed25519-signed keys with a tier and an expiry, capped at five machines, and served
   offline validation, check-in, and a grace window.

The app validated the signed key locally against a baked-in public key, activated once per device, and
re-checked periodically to catch renewal or revocation. A device the licensed-device roster dropped lost
its Pro surfaces at the next revalidation.

## What remains, and why

The key-side plumbing was not deleted wholesale, because two things still need it:

- **Personal Mesh pairing** keys a device's identity to its fingerprint, and the roster of known devices
  rides on that identity. Syncing between your own devices needs it whether or not anything costs money.
- **Grandfathered credentials.** Someone who bought before the tier was removed still holds a key. The
  app can still read, activate, and revalidate it — it simply has no bearing on what they may use.

So the entitlement service, the provider seam it registers, and the lifecycle that revalidates on launch
and foreground all stay. What was removed is every *decision* made from them: `selectHasProAccess` in
`src/stores/proAccessSlice.ts` grants unconditionally, and the paywall surfaces (pricing copy, the Pro
upsell banner, the Aha offer sheet, the licence-key modal, the subscription management card, and the
expiry redirect) are gone.

The other half of the old system — the voice, tool and mesh code — lives in the optional `@offgrid/pro`
bundle (the `pro/` submodule). A build either compiles it in, in which case it is unlocked for everyone,
or it does not, in which case the affected surfaces show an empty state that explains the build rather
than offering a purchase.

## If you are looking for pricing

There is none. See the README section **Everything is free**, and `src/services/proLicenseService.ts` for
the note on what the remaining entitlement plumbing is for.
