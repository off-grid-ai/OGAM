# Fastlane Release Setup

One-time setup to enable **App Store + Play Store** publishing via Fastlane. This is a
NEW distribution path that runs alongside the existing AltStore / GitHub Release flow
(see `release-ios.yml` / `release.yml`) - it does not replace it.

There is **no Fastlane account** - Fastlane is an open-source tool. Everything below is
about getting **Apple** and **Google** credentials and storing them as **GitHub Actions
secrets**.

Mental model:
- Local builds read credentials from `fastlane/.env` (gitignored).
- CI reads the same values from **GitHub Secrets** (injected as env vars).
- Files (the `.p8`, the Play JSON, the keystore, the `.p12`) are stored **base64-encoded**
  as secrets and decoded back to files at runtime.

Base64-encode a file for a secret (macOS):
```sh
base64 -i path/to/file | pbcopy
```

---

## What already exists (do NOT recreate)

These secrets are already in GitHub from the AltStore pipeline and are REUSED for the
App Store signing - no new signing setup needed:

- `IOS_CERTIFICATE_P12` - distribution cert (base64 `.p12`)
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISION_PROFILE` - provisioning profile (base64)
- `KEYCHAIN_PASSWORD`
- `JIRA_API_TOKEN`, `JIRA_BASE_URL` - for the Jira sync work (separate epic)

Apple Team ID is `84V6KCAC49` (from `ios/ExportOptions.plist`).

> If the existing `IOS_CERTIFICATE_P12` is an **Apple Distribution** cert and the
> profile is an **App Store** profile, they work for App Store uploads as-is. If they
> are AltStore/ad-hoc only, you'll need to add an App Store distribution cert + profile
> as new secrets (same names, App Store variants) - check the cert type in the Apple
> Developer portal before the first upload.

---

## NEW credentials to create

### 1. iOS - App Store Connect API key (for UPLOADING)

This lets CI upload builds to TestFlight / App Store (separate from signing).

1. **App Store Connect → Users and Access → Integrations → App Store Connect API**.
2. Generate a key with the **App Manager** role. Download the **`.p8`** (one-time
   download). Note the **Key ID** and **Issuer ID**.
3. Base64-encode it: `base64 -i AuthKey_XXXX.p8 | pbcopy`.

Add as GitHub Secrets:
- `ASC_API_KEY_P8` - base64 `.p8`
- `ASC_KEY_ID`
- `ASC_ISSUER_ID`

For local use, save the key material and point `APP_STORE_CONNECT_API_KEY_PATH` at it in
`fastlane/.env`.

### 2. Android - Google Play service account (for UPLOADING)

1. **Play Console → Setup → API access**.
2. **Create new service account** → in Google Cloud, create it and **Create key → JSON**.
3. Back in Play Console, **Grant access** with the **Release** permission for this app.
4. Base64-encode: `base64 -i play-store-key.json | pbcopy`.

Add as GitHub Secret: `PLAY_STORE_JSON_KEY` (base64 JSON).

### 3. Android - production keystore in CI (for SIGNING)

The app is already live, so reuse the **existing** production keystore (a new one is
rejected by Play). `android/app/build.gradle` reads it from gradle properties
`OFFGRID_UPLOAD_*`.

1. Get the existing release keystore + its passwords/alias from whoever signs releases.
2. Base64-encode the keystore: `base64 -i release.keystore | pbcopy`.

Add as GitHub Secrets:
- `ANDROID_KEYSTORE_BASE64` - base64 keystore
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

> Do not generate a new keystore. If the original is lost, Play App Signing key reset is
> a separate manual process with Google - flag it first.

---

## Full secret checklist

Already present (reused, no action):
- [x] `IOS_CERTIFICATE_P12`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISION_PROFILE`, `KEYCHAIN_PASSWORD`

New - to add:
- [ ] `ASC_API_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID` (iOS upload)
- [ ] `PLAY_STORE_JSON_KEY` (Android upload)
- [ ] `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (Android signing)

Add at: Repo → **Settings → Secrets and variables → Actions → New repository secret**.

---

## Private pro submodule in CI (open-core: don't leak pro source)

The `pro-build` CI job builds the app WITH the private `@offgrid/pro` submodule
(`off-grid-ai/mobile-pro`). It is gated so the private source can never be reached by a
public / fork PR:

- Runs **only on `push`** (`if: github.event_name == 'push'`) - never on `pull_request`.
  Fork PRs get the free/stub build (metro aliases `@offgrid/pro` -> `proStub.js` when
  `pro/` is absent), which is correct for open-source contributions.
- Reads `PRO_REPO_TOKEN` from a **protected GitHub Environment** so only maintainer-
  approved runs can access it.

### One-time GitHub setup for the pro build

1. **Create a fine-grained PAT** - read-only, scoped to `off-grid-ai/mobile-pro` **only**:
   github.com/settings/tokens?type=beta → Repository access: only `mobile-pro`,
   Permissions: **Contents: Read-only**. Copy the token.
2. **Create a protected Environment** - Repo → Settings → Environments → **New
   environment** named `pro-build`. Add a **Required reviewer** (a maintainer) and/or
   restrict to protected branches, so the token is only released on approved runs.
3. **Add the token to that environment** - inside the `pro-build` environment →
   **Environment secrets** → add `PRO_REPO_TOKEN` = the PAT from step 1. (Environment
   secret, not a plain repo secret - that's what scopes it to this gated job.)

Why a token at all: submodule checkout of a **private** repo needs auth. Scoping it
read-only + single-repo + environment-gated means a leak (which the fork rule already
prevents) still couldn't write or reach anything else.

## Test it

**Build-only (no upload, no store secrets) - runs in CI now:**
The `fastlane-build` job in `.github/workflows/ci.yml` runs `fastlane android build` on a
clean JDK-17 runner and uploads the AAB as an artifact. This verifies the pipeline with
zero store risk.

**Local (needs `fastlane/.env`):**
```sh
bundle exec fastlane lanes
bundle exec fastlane bump            # bumps version (revert after)
bundle exec fastlane android beta    # AAB -> Play internal track (draft)
bundle exec fastlane ios beta        # IPA -> TestFlight
```

Release lanes upload as **draft / not submitted** - a human confirms rollout in the Play
Console / App Store Connect.

> Local Android builds need `ANDROID_HOME` set and **JDK 17** (JDK 24 breaks the native
> op-sqlite build). See `RELEASING.md` for the local toolchain gotchas. Easiest is to let
> CI run the build.

---

## What never gets committed

`fastlane/.env`, `fastlane/play-store-key.json`, `fastlane/asc-api-key.json`, any `.p8`,
and keystores are gitignored. Only `fastlane/.env.example` (placeholders) is committed.

## Tracked in Jira

Epic **Release & Hygiene (SCRUM-166)**:
- SCRUM-182 - wire supply/deliver + enable release workflows
- SCRUM-185 - store-listing image assets
- SCRUM-179 - iOS signing (now: reuse existing P12, not match)
