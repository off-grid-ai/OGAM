#!/usr/bin/env bash
set -euo pipefail

# promote.sh - bless a tested BETA cut to production on all three channels, reusing
# the EXACT bytes that were tested. The other half of scripts/uat.sh (which cuts a
# beta to Play internal + TestFlight + a GitHub prerelease). Nothing here rebuilds
# the app.
#
#   Usage: scripts/promote.sh v0.0.103-beta.1 [--ios|--android|--github]   (no target arg = all three)
#
# What it does (promote-as-is, per channel):
#   * Repo:    tag v<version> ON THE TESTED BETA COMMIT (not arbitrary HEAD), bump
#              package.json there, push the intended branch + tag.
#   * Play:    fastlane android promote - moves the internal AAB to production (draft),
#              PINNED to the tested versionCode recovered from the beta tag.
#   * iOS:     fastlane ios promote - attaches the EXACT tested TestFlight build (pinned
#              by build_number) to a new App Store version (no binary upload).
#   * GitHub:  download the APK from the beta prerelease and re-attach it to a fresh
#              v<version> full release (not prerelease, marked latest). No rebuild.
#
# The tested store build id (Android versionCode / iOS CURRENT_PROJECT_VERSION) is the
# SINGLE SOURCE OF TRUTH: uat.sh records it in the beta tag's annotation ("Build: <n>", a
# format owned by scripts/lib/version.js) and this script reads it back to pin the exact
# tested bytes on both stores instead of "whatever is latest on the track".
#
# Two final gates stay MANUAL, by design (a script must not do these):
#   * Play:    the production release is a DRAFT - confirm the rollout % in the console.
#   * iOS:     the App Store version is created but NOT submitted - hit Submit in ASC.
#
# Credentials come from fastlane/.env (same as uat.sh). Requires: node, gh, bundle.
# The release commit is pushed to PROMOTE_BRANCH (default "main"); override to release off a
# different branch, e.g. PROMOTE_BRANCH=release/0.0.103 scripts/promote.sh v0.0.103-beta.1.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

BETA_TAG="${1:-}"
[ -n "$BETA_TAG" ] || error "Usage: scripts/promote.sh <beta-tag> [--ios|--android|--github]  (e.g. v0.0.103-beta.1)"

DO_IOS=1; DO_ANDROID=1; DO_GITHUB=1
case "${2:-}" in
  --ios)     DO_ANDROID=0; DO_GITHUB=0 ;;
  --android) DO_IOS=0; DO_GITHUB=0 ;;
  --github)  DO_IOS=0; DO_ANDROID=0 ;;
  "" ) ;;
  * ) error "Unknown arg '$2'. Use --ios, --android, --github, or no arg for all." ;;
esac

# ── pre-flight ─────────────────────────────────────────────────────
command -v node   >/dev/null || error "node not installed"
command -v gh     >/dev/null || error "gh CLI not installed"
command -v bundle >/dev/null || error "bundler not installed (bundle install)"
[ -f fastlane/Fastfile ]     || error "fastlane/Fastfile not found"
[ -z "$(git status --porcelain)" ] || error "Working tree is dirty. Commit or stash first."

# ── derive the target version from the beta tag (single source of truth) ──
TARGET_VERSION=$(node scripts/lib/version.js target-from-beta "$BETA_TAG") || error "Could not derive a version from '$BETA_TAG'"
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Promoting ${BOLD}${BETA_TAG}${NC} → production ${BOLD}${TARGET_VERSION}${NC} (package.json currently ${CURRENT_VERSION})"

# ── assert we are promoting what was tested: the beta tag's commit is on main ──
git fetch --tags --quiet origin || error "Could not fetch tags/refs"
git rev-parse -q --verify "refs/tags/${BETA_TAG}" >/dev/null || error "Tag ${BETA_TAG} not found locally (git fetch --tags)"
BETA_SHA=$(git rev-list -n1 "$BETA_TAG")
if ! git merge-base --is-ancestor "$BETA_SHA" origin/main; then
  error "The commit for ${BETA_TAG} (${BETA_SHA:0:8}) is NOT on origin/main. Refusing to promote a build that isn't on main."
fi
info "Verified ${BETA_TAG} (${BETA_SHA:0:8}) is on origin/main."

# ── recover the tested store build id from the beta tag (single source of truth) ──
# uat.sh annotated the beta tag with "Build: <n>". We read it back here so the store promotes
# are PINNED to the exact tested versionCode / TestFlight build, not "latest processed". If it
# is unrecoverable we FAIL FAST rather than silently promote the wrong bytes. The annotated
# tag is primary; the GitHub prerelease body is a fallback recovery path (uat.sh writes both).
TAG_ANNOTATION=$(git for-each-ref "refs/tags/${BETA_TAG}" --format='%(contents)')
TESTED_BUILD=$(node scripts/lib/version.js build-from-annotation "$TAG_ANNOTATION" 2>/dev/null || echo "")
if [ -z "$TESTED_BUILD" ]; then
  warn "No build id in the ${BETA_TAG} tag annotation - trying the GitHub prerelease body…"
  GH_BODY=$(gh release view "$BETA_TAG" --json body -q .body 2>/dev/null || echo "")
  TESTED_BUILD=$(node scripts/lib/version.js build-from-annotation "$GH_BODY" 2>/dev/null || echo "")
fi
[ -n "$TESTED_BUILD" ] || error "Could not recover the tested build id for ${BETA_TAG} (no 'Build: <n>' in the tag annotation or the GitHub prerelease body). Refusing to promote 'latest' and risk shipping the wrong build. Re-cut the beta with a uat.sh that records the build id."
info "Tested build id for ${BETA_TAG}: ${BOLD}${TESTED_BUILD}${NC} (pins Play versionCode + TestFlight build)."

# ── 1. reconcile the repo: tag v<version> ON THE TESTED BETA COMMIT, bump, push ──
# The vX.Y.Z tag MUST map to the tested beta lineage, so we base the release commit on
# BETA_SHA - never on the operator's current HEAD, which can be ahead of / different from the
# tested bytes. PROMOTE_BRANCH is the branch the release commit is pushed to (default main).
PROMOTE_BRANCH="${PROMOTE_BRANCH:-main}"
REMOTE_HAS_TAG=$(git ls-remote --tags origin "refs/tags/v${TARGET_VERSION}" 2>/dev/null || echo "")
if [ -n "$REMOTE_HAS_TAG" ]; then
  # Already released on origin - a true idempotent no-op for the repo step.
  warn "Tag v${TARGET_VERSION} already on origin - skipping the version bump/tag (already released)."
else
  # The tag may exist ONLY locally (a prior run created it but the push failed). Do NOT skip in
  # that case - re-attempt the push so a partial run becomes complete. Only (re)create the
  # commit/tag when they are absent locally too.
  if ! git rev-parse -q --verify "refs/tags/v${TARGET_VERSION}" >/dev/null; then
    info "Basing v${TARGET_VERSION} on the tested commit ${BETA_SHA:0:8}, bumping package.json, tagging."
    # Work on a detached checkout of the TESTED commit so the bump/tag ride the tested bytes.
    git checkout --quiet "$BETA_SHA"
    node -e "const fs=require('fs'),p=require('./package.json');p.version='${TARGET_VERSION}';fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
    # Keep package-lock's top-level version in step if present (no full reinstall).
    [ -f package-lock.json ] && node -e "const fs=require('fs'),l=require('./package-lock.json');l.version='${TARGET_VERSION}';if(l.packages&&l.packages['']){l.packages[''].version='${TARGET_VERSION}';}fs.writeFileSync('./package-lock.json',JSON.stringify(l,null,2)+'\n')" || true
    git add package.json package-lock.json 2>/dev/null || git add package.json
    git commit -m "chore(release): ${TARGET_VERSION}"
    git tag "v${TARGET_VERSION}"
  else
    warn "Tag v${TARGET_VERSION} exists locally but NOT on origin - a prior run's push failed. Re-attempting the push (idempotent)."
  fi
  # Push the release commit to the intended branch and the tag, explicitly. Fast-forward only:
  # if the branch has moved on origin we stop rather than force-push over someone else's work.
  RELEASE_COMMIT=$(git rev-list -n1 "v${TARGET_VERSION}")
  git push origin "${RELEASE_COMMIT}:refs/heads/${PROMOTE_BRANCH}" || error "Could not fast-forward origin/${PROMOTE_BRANCH} to the release commit. Reconcile the branch and re-run (the tag will be re-pushed)."
  git push origin "refs/tags/v${TARGET_VERSION}"
fi

# ── 2. Play: promote the tested internal build to production (draft), version-pinned ──
if [ "$DO_ANDROID" = 1 ]; then
  info "Play: promoting the tested internal build (versionCode ${TESTED_BUILD}) to production (draft)…"
  bundle exec fastlane android promote version_code:"${TESTED_BUILD}"
  info "Play done - open Play Console then Production and confirm the rollout %."
fi

# ── 3. App Store: attach the EXACT tested TestFlight build to a new version ──
if [ "$DO_IOS" = 1 ]; then
  info "App Store: attaching the tested TestFlight build (${TESTED_BUILD}) to version ${TARGET_VERSION}…"
  bundle exec fastlane ios promote app_version:"${TARGET_VERSION}" build_number:"${TESTED_BUILD}"
  info "App Store done - open App Store Connect and hit Submit for Review."
fi

# ── 4. GitHub: cut a clean v<version> full release from the tested APK ──
if [ "$DO_GITHUB" = 1 ]; then
  info "GitHub: cutting v${TARGET_VERSION} from the tested ${BETA_TAG} APK (no rebuild)…"
  TMP_ASSETS="$(mktemp -d)"
  trap 'rm -rf "$TMP_ASSETS"' EXIT
  # Reuse the tested bytes: download the APK attached to the beta prerelease.
  if gh release download "$BETA_TAG" -D "$TMP_ASSETS" --pattern "*.apk" 2>/dev/null; then
    APK=$(find "$TMP_ASSETS" -name "*.apk" | head -1)
  else
    APK=""
  fi
  # mktemp returns a REAL path; appending ".md" would orphan that file and misdirect the
  # `rm -f "$NOTES_FILE"` cleanup. Use the path mktemp actually created.
  NOTES_FILE="$(mktemp -t promote-notes)"
  # Carry the beta's own notes forward if present, else a minimal note.
  gh release view "$BETA_TAG" --json body -q .body > "$NOTES_FILE" 2>/dev/null || echo "Off Grid ${TARGET_VERSION}" > "$NOTES_FILE"
  if gh release view "v${TARGET_VERSION}" >/dev/null 2>&1; then
    warn "GitHub release v${TARGET_VERSION} already exists - skipping (idempotent re-run)."
  elif [ -n "$APK" ]; then
    gh release create "v${TARGET_VERSION}" "$APK" --title "Off Grid ${TARGET_VERSION}" --notes-file "$NOTES_FILE" --latest
    info "Cut GitHub release v${TARGET_VERSION} with the tested APK."
  else
    warn "No APK found on ${BETA_TAG} - creating the release without a binary (attach manually or run the iOS AltStore workflow)."
    gh release create "v${TARGET_VERSION}" --title "Off Grid ${TARGET_VERSION}" --notes-file "$NOTES_FILE" --latest
  fi
  rm -f "$NOTES_FILE"
fi

echo ""
info "${BOLD}Promotion staged for ${TARGET_VERSION}.${NC} Remaining MANUAL gates:"
[ "$DO_ANDROID" = 1 ] && echo "  • Play Console  → Production → confirm rollout %"
[ "$DO_IOS" = 1 ]     && echo "  • App Store Connect → Submit for Review"
