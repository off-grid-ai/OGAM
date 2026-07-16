#!/usr/bin/env bash
set -euo pipefail

# uat.sh - ship a BETA build to internal testers (TestFlight + Play internal) and cut a
# GitHub PRERELEASE tag. Same fundamental as scripts/release.sh (build locally, generate
# grouped release notes, tag on GitHub) - but flavored as a beta:
#
#   * Beta version = <NEXT patch>-beta.<N> (e.g. current live 0.0.102 → 0.0.103-beta.1). A
#     beta is a PRE-RELEASE OF THE NEXT version, never the current one: the current version
#     is already LIVE on the stores, so its TestFlight train is CLOSED to new builds
#     ("Invalid Pre-Release Train"). N auto-increments from the last matching prerelease tag.
#   * Store build number (Android versionCode / iOS CURRENT_PROJECT_VERSION) = unix
#     timestamp, so every TestFlight / Play upload is unique + increasing. Stores order
#     builds by this number, NOT by the version string.
#   * The store BINARY carries the plain PRODUCTION version on BOTH platforms (Android
#     versionName + iOS MARKETING_VERSION = the NEXT numeric version, no "-beta" suffix). A
#     suffix is user-visible and frozen into the binary, so it would block promote-as-is
#     (a tested beta build being promoted internal→production unchanged) and get carried to
#     production forever. The "-beta.N" label lives only in the git tag, the GitHub
#     prerelease, and the store release notes - never in the shipped binary. Approve a beta,
#     then run scripts/promote.sh <tag> to bless that exact tested build to production.
#   * Release notes are generated FROM THE COMMITS by `claude -p` (falls back to a grouped
#     commit list), and pushed to TestFlight (What to Test) + Play internal + the GH release.
#
# Usage: scripts/uat.sh [--ios|--android]   (no arg = both)
#
# Build → upload → THEN commit/tag/push, so a failed build never leaves a dangling tag.
# Credentials come from fastlane/.env (see fastlane/.env.example). On a Mac whose keychain
# already holds the distribution cert, export SKIP_KEYCHAIN_IMPORT=1.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

DO_IOS=1; DO_ANDROID=1
case "${1:-}" in
  --ios) DO_ANDROID=0 ;; --android) DO_IOS=0 ;; "" ) ;;
  * ) error "Unknown arg '$1'. Use --ios, --android, or no arg for both." ;;
esac

# ── pre-flight ─────────────────────────────────────────────────────
command -v node   >/dev/null || error "node not installed"
command -v gh     >/dev/null || error "gh CLI not installed"
command -v bundle >/dev/null || error "bundler not installed (bundle install)"
[ -f fastlane/Fastfile ]     || error "fastlane/Fastfile not found"
# Ignore fastlane/README.md — fastlane regenerates it on every run, so it is dirty by the time a
# second build starts (and after any prior run). It is not source we build from.
[ -z "$(git status --porcelain | grep -vE 'fastlane/README\.md$' || true)" ] || error "Working tree is dirty. Commit or stash first."
[ "$DO_ANDROID" = 0 ] || { [ -f android/gradlew ] || error "android/gradlew not found"; [ -n "${ANDROID_HOME:-}" ] || error "ANDROID_HOME not set"; }
[ "$DO_IOS" = 0 ]     || command -v xcodebuild >/dev/null || error "xcodebuild not installed"

# ── compute the beta version ───────────────────────────────────────
# A beta targets the NEXT version, not the live one (the live train is closed - see header).
CURRENT_VERSION=$(node -p "require('./package.json').version")   # e.g. 0.0.102 (live)
TARGET_VERSION=$(node -e "const [a,b,c]=require('./package.json').version.split('.').map(Number); console.log(a+'.'+b+'.'+(c+1))")   # 0.0.103
# --no-recurse-submodules: this fetch only needs CORE tags to pick the next beta number. Recursing
# into the pro submodule made it try to fetch pro commits referenced by old tag history that are no
# longer on pro's remote (e.g. after a pro branch was deleted/rebased) → "not our ref" → the whole
# tag refresh failed and blocked the build. The submodule is already checked out at the pinned commit.
git fetch --tags --no-recurse-submodules --quiet || error "Could not refresh tags. Refusing to pick a beta number from stale tag history (would risk reusing an already-published beta tag and failing the tag push after the store uploads)."
LAST_N=$(git tag -l "v${TARGET_VERSION}-beta.*" | sed -E "s/.*-beta\.([0-9]+)$/\1/" | sort -n | tail -1)
N=$(( ${LAST_N:-0} + 1 ))
BETA_VERSION="${TARGET_VERSION}-beta.${N}"
TAG="v${BETA_VERSION}"
BUILD_NUMBER=$(date +%s)
info "Beta build: ${BOLD}${BETA_VERSION}${NC} (build ${BUILD_NUMBER}) - pre-release of ${TARGET_VERSION} (current live: ${CURRENT_VERSION})"

# ── apply the build-number / beta-versionName bump (working tree; committed only on success) ──
if [ "$DO_ANDROID" = 1 ]; then
  sed -i '' "s/versionCode .*/versionCode $BUILD_NUMBER/" android/app/build.gradle
  # versionName = the PRODUCTION version (no -beta suffix), matching iOS's MARKETING_VERSION
  # below. versionName is frozen into the AAB and is user-visible, so a "-beta" suffix here
  # would ride the exact tested bytes to production forever and block Play's promote-as-is
  # (internal -> production, same AAB). Play orders builds by versionCode (the timestamp
  # above), NOT versionName, so a non-incrementing versionName across betas is fine. The
  # "-beta.N" label lives in the git tag, the GitHub prerelease, and the store release notes.
  sed -i '' "s/versionName .*/versionName \"$TARGET_VERSION\"/" android/app/build.gradle
fi
if [ "$DO_IOS" = 1 ]; then
  # iOS marketing version = NEXT plain numeric version (App Store rejects "-beta", and this
  # opens a fresh TestFlight train since the live version's train is closed); build no. bumps.
  sed -i '' "s/MARKETING_VERSION = .*/MARKETING_VERSION = $TARGET_VERSION;/" ios/OffgridMobile.xcodeproj/project.pbxproj
  sed -i '' "s/CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/" ios/OffgridMobile.xcodeproj/project.pbxproj
fi
cleanup() {
  git checkout -- android/app/build.gradle ios/OffgridMobile.xcodeproj/project.pbxproj 2>/dev/null || true
  rm -f "$NOTES_FILE" "${ANDROID_CHANGELOG:-}" 2>/dev/null || true
}
trap 'cleanup' EXIT

# ── generate release notes from commits (claude -p, else grouped fallback) ──
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
RANGE=${LAST_TAG:+${LAST_TAG}..HEAD}
COMMITS=$(git log ${RANGE:-HEAD~30..HEAD} --pretty=format:"%s (%h)" --no-merges 2>/dev/null || git log --pretty=format:"%s (%h)" --no-merges -30)
# Notes live OUTSIDE the repo so they never dirty the tree (a failed run must not block the
# next). The Android changelog (written under fastlane/metadata by the beta lane) IS in-repo;
# the trap below removes it on any exit so leftovers can't fail the clean-tree pre-check.
NOTES_FILE="$(mktemp -t uat-notes).md"
ANDROID_CHANGELOG="$ROOT_DIR/fastlane/metadata/android/en-US/changelogs/${BUILD_NUMBER}.txt"

gen_notes_with_claude() {
  command -v claude >/dev/null || return 1
  printf '%s\n' "$COMMITS" | claude -p \
"Turn these git commits into concise user-facing beta release notes for testers of Off Grid AI (a private on-device AI app). Group under short markdown headings (Features / Fixes / Improvements). One bullet per user-visible change, plain language, focus on the outcome. Follow the brand voice: no em dashes, no exclamation marks, no words like revolutionary/seamlessly/robust. Output ONLY the markdown, no preamble." \
    2>/dev/null
}

if NOTES=$(gen_notes_with_claude) && [ -n "$NOTES" ]; then
  printf '%s\n' "$NOTES" > "$NOTES_FILE"
  info "Release notes generated by claude -p"
else
  warn "claude -p unavailable/failed - falling back to a grouped commit list"
  {
    echo "## ${BETA_VERSION}"; echo ""
    # `|| true` on each: under set -euo pipefail a grep with no match returns non-zero and
    # would abort the whole script (e.g. a beta with only chore/test commits and no feat/fix).
    printf '%s\n' "$COMMITS" | grep -iE "^feat" | sed 's/^/- /' || true
    printf '%s\n' "$COMMITS" | grep -iE "^fix"  | sed 's/^/- /' || true
    printf '%s\n' "$COMMITS" | grep -ivE "^(feat|fix|chore|test|docs|ci|refactor)" | sed 's/^/- /' || true
  } > "$NOTES_FILE"
fi
export UAT_CHANGELOG_PATH="$NOTES_FILE"
info "Notes:"; sed 's/^/    /' "$NOTES_FILE"; echo ""

# ── BUILD everything first, publish nothing yet ────────────────────
# Singular creation: a build/signing failure must NEVER leave a half-published beta (e.g. an
# Android bundle already on Play with no matching TestFlight build, which then piles up on
# every retry). So we build ALL artifacts up front - the steps that actually fail (compile,
# signing, export) happen before a single upload - and only publish once every artifact
# exists. The fastlane beta lanes read UAT_CHANGELOG_PATH at upload time.
if [ "$DO_ANDROID" = 1 ]; then
  info "Android → building signed AAB…"; bundle exec fastlane android build
  # Also build the sideloadable APK for the GitHub prerelease (the AAB isn't installable;
  # testers grabbing the build off GitHub need the APK - same as scripts/release.sh).
  info "Android → building installable APK for GitHub…"; (cd android && ./gradlew assembleRelease)
  AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
  APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$AAB_SRC" ] || error "AAB not found at $AAB_SRC"
  [ -f "$APK_SRC" ] || error "APK not found at $APK_SRC"
fi
if [ "$DO_IOS" = 1 ]; then
  info "iOS → building signed IPA…"; bundle exec fastlane ios build
  [ -f build/OffgridMobile.ipa ] || error "IPA not found at build/OffgridMobile.ipa"
fi

# ── PUBLISH - reached only if every build above succeeded ───────────
if [ "$DO_ANDROID" = 1 ]; then info "Android → Play internal (AAB)…"; bundle exec fastlane android upload_beta; fi
if [ "$DO_IOS" = 1 ];     then info "iOS → TestFlight…";              bundle exec fastlane ios upload_beta;     fi

# ── success → commit the bump, cut the PRERELEASE tag, GH prerelease ──
trap - EXIT   # keep the bump now that the build shipped
FILES=(); [ "$DO_ANDROID" = 1 ] && FILES+=(android/app/build.gradle)
[ "$DO_IOS" = 1 ] && FILES+=(ios/OffgridMobile.xcodeproj/project.pbxproj)
git add "${FILES[@]}"
git commit -m "chore(beta): ${BETA_VERSION} (build ${BUILD_NUMBER}) [skip ci]"
# Annotate the tag with the tested store build id (Android versionCode / iOS
# CURRENT_PROJECT_VERSION). This is the SINGLE SOURCE OF TRUTH promote.sh reads back so it
# pins the EXACT tested build on both stores instead of "latest processed". The line format
# is owned by scripts/lib/version.js so the writer here and the reader in promote can never
# drift. Also stored in the GitHub prerelease body below as a redundant recovery path.
BUILD_LINE=$(node scripts/lib/version.js build-line "$BUILD_NUMBER") || error "Could not format the build annotation for ${BUILD_NUMBER}"
git tag -a "$TAG" -m "Off Grid ${BETA_VERSION}

${BUILD_LINE}"
git push && git push origin "$TAG"

# Attach both the installable APK (for sideload testers) and the AAB (Play-store artifact),
# version-named so the release page is self-describing.
GH_ARGS=()
APK_DST="$ROOT_DIR/OffgridMobile-${BETA_VERSION}.apk"
AAB_DST="$ROOT_DIR/OffgridMobile-${BETA_VERSION}.aab"
if [ "$DO_ANDROID" = 1 ]; then
  [ -f android/app/build/outputs/apk/release/app-release.apk ] && \
    { cp android/app/build/outputs/apk/release/app-release.apk "$APK_DST"; GH_ARGS+=("$APK_DST"); }
  [ -f android/app/build/outputs/bundle/release/app-release.aab ] && \
    { cp android/app/build/outputs/bundle/release/app-release.aab "$AAB_DST"; GH_ARGS+=("$AAB_DST"); }
fi
# Carry the tested build id into the prerelease body too (redundant with the annotated tag),
# so `gh release view "$TAG"` is a second recovery path if the local tag object is missing.
printf '\n\n%s\n' "$BUILD_LINE" >> "$NOTES_FILE"
gh release create "$TAG" "${GH_ARGS[@]}" --prerelease --title "Off Grid ${BETA_VERSION} (beta)" --notes-file "$NOTES_FILE"

# Announce the beta in Slack — fail-soft, a chat message must never fail a shipped build. Webhook comes
# from .env.keygen locally (mirrors the SLACK_WEBHOOK_URL repo secret the release workflows use);
# notify-slack-release.mjs no-ops if it is unset.
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-$(sed -n 's/^SLACK_WEBHOOK_URL=//p' "$ROOT_DIR/.env.keygen" 2>/dev/null)}" \
  PRODUCT="Off Grid AI Mobile" VERSION="$BETA_VERSION" CHANNEL_LABEL="beta" \
  RELEASE_URL="$(gh release view "$TAG" --json url -q .url 2>/dev/null)" NOTES_FILE="$NOTES_FILE" \
  node "$ROOT_DIR/scripts/notify-slack-release.mjs" || true

rm -f "$NOTES_FILE" "${ANDROID_CHANGELOG:-}" "$APK_DST" "$AAB_DST"
echo ""
info "${BOLD}Beta ${BETA_VERSION} shipped.${NC}"
[ "$DO_IOS" = 1 ]     && info "  iOS:     TestFlight (App Store Connect → TestFlight)"
[ "$DO_ANDROID" = 1 ] && info "  Android: Play Console → Internal testing"
info "  GitHub:  $(gh release view "$TAG" --json url -q .url 2>/dev/null)"
info "Approve the beta, then run scripts/release.sh to cut the real version to production."
