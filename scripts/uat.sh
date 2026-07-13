#!/usr/bin/env bash
set -euo pipefail

# uat.sh — ship a BETA build to internal testers (TestFlight + Play internal) and cut a
# GitHub PRERELEASE tag. Same fundamental as scripts/release.sh (build locally, generate
# grouped release notes, tag on GitHub) — but flavored as a beta:
#
#   * Beta version = <NEXT patch>-beta.<N> (e.g. current live 0.0.102 → 0.0.103-beta.1). A
#     beta is a PRE-RELEASE OF THE NEXT version, never the current one: the current version
#     is already LIVE on the stores, so its TestFlight train is CLOSED to new builds
#     ("Invalid Pre-Release Train") and Play rejects a versionName <= the live one. N
#     auto-increments from the last matching prerelease tag. release.sh bumps package.json
#     to the real next version once a beta is approved.
#   * Store build number (Android versionCode / iOS CURRENT_PROJECT_VERSION) = unix
#     timestamp, so every TestFlight / Play upload is unique + increasing.
#   * iOS MARKETING_VERSION is set to the NEXT plain numeric version (App Store rejects a
#     "-beta" suffix, and this opens a fresh TestFlight train); the "-beta.N" label lives in
#     the git tag, the Android versionName, and the store release notes.
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
[ -z "$(git status --porcelain)" ] || error "Working tree is dirty. Commit or stash first."
[ "$DO_ANDROID" = 0 ] || { [ -f android/gradlew ] || error "android/gradlew not found"; [ -n "${ANDROID_HOME:-}" ] || error "ANDROID_HOME not set"; }
[ "$DO_IOS" = 0 ]     || command -v xcodebuild >/dev/null || error "xcodebuild not installed"

# ── compute the beta version ───────────────────────────────────────
# A beta targets the NEXT version, not the live one (the live train is closed — see header).
CURRENT_VERSION=$(node -p "require('./package.json').version")   # e.g. 0.0.102 (live)
TARGET_VERSION=$(node -e "const [a,b,c]=require('./package.json').version.split('.').map(Number); console.log(a+'.'+b+'.'+(c+1))")   # 0.0.103
git fetch --tags --quiet || error "Could not refresh tags. Refusing to pick a beta number from stale tag history (would risk reusing an already-published beta tag and failing the tag push after the store uploads)."
LAST_N=$(git tag -l "v${TARGET_VERSION}-beta.*" | sed -E "s/.*-beta\.([0-9]+)$/\1/" | sort -n | tail -1)
N=$(( ${LAST_N:-0} + 1 ))
BETA_VERSION="${TARGET_VERSION}-beta.${N}"
TAG="v${BETA_VERSION}"
BUILD_NUMBER=$(date +%s)
info "Beta build: ${BOLD}${BETA_VERSION}${NC} (build ${BUILD_NUMBER}) — pre-release of ${TARGET_VERSION} (current live: ${CURRENT_VERSION})"

# ── apply the build-number / beta-versionName bump (working tree; committed only on success) ──
if [ "$DO_ANDROID" = 1 ]; then
  sed -i '' "s/versionCode .*/versionCode $BUILD_NUMBER/" android/app/build.gradle
  sed -i '' "s/versionName .*/versionName \"$BETA_VERSION\"/" android/app/build.gradle
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
  warn "claude -p unavailable/failed — falling back to a grouped commit list"
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
# every retry). So we build ALL artifacts up front — the steps that actually fail (compile,
# signing, export) happen before a single upload — and only publish once every artifact
# exists. The fastlane beta lanes read UAT_CHANGELOG_PATH at upload time.
if [ "$DO_ANDROID" = 1 ]; then
  info "Android → building signed AAB…"; bundle exec fastlane android build
  # Also build the sideloadable APK for the GitHub prerelease (the AAB isn't installable;
  # testers grabbing the build off GitHub need the APK — same as scripts/release.sh).
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

# ── PUBLISH — reached only if every build above succeeded ───────────
if [ "$DO_ANDROID" = 1 ]; then info "Android → Play internal (AAB)…"; bundle exec fastlane android upload_beta; fi
if [ "$DO_IOS" = 1 ];     then info "iOS → TestFlight…";              bundle exec fastlane ios upload_beta;     fi

# ── success → commit the bump, cut the PRERELEASE tag, GH prerelease ──
trap - EXIT   # keep the bump now that the build shipped
FILES=(); [ "$DO_ANDROID" = 1 ] && FILES+=(android/app/build.gradle)
[ "$DO_IOS" = 1 ] && FILES+=(ios/OffgridMobile.xcodeproj/project.pbxproj)
git add "${FILES[@]}"
git commit -m "chore(beta): ${BETA_VERSION} (build ${BUILD_NUMBER}) [skip ci]"
git tag -a "$TAG" -m "Off Grid ${BETA_VERSION}"
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
gh release create "$TAG" "${GH_ARGS[@]}" --prerelease --title "Off Grid ${BETA_VERSION} (beta)" --notes-file "$NOTES_FILE"

rm -f "$NOTES_FILE" "${ANDROID_CHANGELOG:-}" "$APK_DST" "$AAB_DST"
echo ""
info "${BOLD}Beta ${BETA_VERSION} shipped.${NC}"
[ "$DO_IOS" = 1 ]     && info "  iOS:     TestFlight (App Store Connect → TestFlight)"
[ "$DO_ANDROID" = 1 ] && info "  Android: Play Console → Internal testing"
info "  GitHub:  $(gh release view "$TAG" --json url -q .url 2>/dev/null)"
info "Approve the beta, then run scripts/release.sh to cut the real version to production."
