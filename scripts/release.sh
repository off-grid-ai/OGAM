#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────────────
command -v node       >/dev/null || error "node is not installed"
command -v gh         >/dev/null || error "gh CLI is not installed (brew install gh)"
command -v xcodebuild >/dev/null || error "xcodebuild is not installed (need Xcode)"
[ -f android/gradlew ]          || error "android/gradlew not found"
[ -n "${ANDROID_HOME:-}" ]      || error "ANDROID_HOME is not set"

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  error "Working tree is dirty. Commit or stash changes first."
fi

# ── 1. Bump version ────────────────────────────────────────────────
info "Bumping patch version..."
npm version patch --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
VERSION_CODE=$(date +%s)

info "New version: ${BOLD}$NEW_VERSION${NC}  (versionCode: $VERSION_CODE)"

# Update Android build.gradle
sed -i '' "s/versionCode .*/versionCode $VERSION_CODE/" android/app/build.gradle
sed -i '' "s/versionName .*/versionName \"$NEW_VERSION\"/" android/app/build.gradle

# Update iOS project.pbxproj (MARKETING_VERSION + CURRENT_PROJECT_VERSION)
PBXPROJ="ios/OffgridMobile.xcodeproj/project.pbxproj"
sed -i '' "s/MARKETING_VERSION = .*/MARKETING_VERSION = $NEW_VERSION;/" "$PBXPROJ"
sed -i '' "s/CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = $VERSION_CODE;/" "$PBXPROJ"

info "iOS version synced: MARKETING_VERSION=$NEW_VERSION, CURRENT_PROJECT_VERSION=$VERSION_CODE"

git add package.json package-lock.json android/app/build.gradle "$PBXPROJ"
git commit -m "chore: bump version to $NEW_VERSION [skip ci]"

# ── 2. Generate grouped release notes ──────────────────────────────
info "Generating release notes..."

git fetch --tags
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LAST_TAG" ]; then
  COMMITS=$(git log --pretty=format:"%s (%h)" --no-merges -50)
else
  COMMITS=$(git log "${LAST_TAG}..HEAD" --pretty=format:"%s (%h)" --no-merges)
fi

FEATURES="" FIXES="" CHORES="" REFACTORS="" TESTS="" DOCS="" CI_CHANGES="" OTHER=""

while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in
    feat:*|feat\(*) FEATURES="${FEATURES}- ${line}\n" ;;
    fix:*|fix\(*)   FIXES="${FIXES}- ${line}\n" ;;
    chore:*|chore\(*) CHORES="${CHORES}- ${line}\n" ;;
    refactor:*|refactor\(*) REFACTORS="${REFACTORS}- ${line}\n" ;;
    test:*|test\(*) TESTS="${TESTS}- ${line}\n" ;;
    docs:*|docs\(*) DOCS="${DOCS}- ${line}\n" ;;
    ci:*|ci\(*)     CI_CHANGES="${CI_CHANGES}- ${line}\n" ;;
    *)              OTHER="${OTHER}- ${line}\n" ;;
  esac
done <<< "$COMMITS"

NOTES_FILE="$ROOT_DIR/release-notes.md"
{
  echo "## What's Changed in v${NEW_VERSION}"
  echo ""
  [ -n "$FEATURES" ]   && echo "### Features"      && printf '%b' "$FEATURES"
  [ -n "$FIXES" ]      && echo "### Bug Fixes"      && printf '%b' "$FIXES"
  [ -n "$REFACTORS" ]  && echo "### Refactors"      && printf '%b' "$REFACTORS"
  [ -n "$CHORES" ]     && echo "### Chores"          && printf '%b' "$CHORES"
  [ -n "$TESTS" ]      && echo "### Tests"           && printf '%b' "$TESTS"
  [ -n "$DOCS" ]       && echo "### Documentation"   && printf '%b' "$DOCS"
  [ -n "$CI_CHANGES" ] && echo "### CI/CD"           && printf '%b' "$CI_CHANGES"
  [ -n "$OTHER" ]      && echo "### Other"           && printf '%b' "$OTHER"
  echo "---"
  echo "**Full Changelog**: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/compare/${LAST_TAG:-v0.0.0}...v${NEW_VERSION}"
} > "$NOTES_FILE"

info "Release notes:"
cat "$NOTES_FILE"
echo ""

# ── 3. Build APK ───────────────────────────────────────────────────
info "Building release APK..."
(cd android && ./gradlew assembleRelease)

APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
APK_DST="android/app/build/outputs/apk/release/OffgridMobile-v${NEW_VERSION}.apk"
[ -f "$APK_SRC" ] || error "APK not found at $APK_SRC"
mv "$APK_SRC" "$APK_DST"
info "APK ready: $APK_DST"

# ── 4. Build AAB ───────────────────────────────────────────────────
info "Building release AAB..."
(cd android && ./gradlew bundleRelease)

AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
AAB_DST="android/app/build/outputs/bundle/release/OffgridMobile-v${NEW_VERSION}.aab"
[ -f "$AAB_SRC" ] || error "AAB not found at $AAB_SRC"
mv "$AAB_SRC" "$AAB_DST"
info "AAB ready: $AAB_DST (not uploaded — copy manually for Play Store)"

# ── 5. Push version bump & create GitHub release ───────────────────
info "Pushing version bump..."
git push

info "Creating GitHub release v${NEW_VERSION}..."
gh release create "v${NEW_VERSION}" \
  "$APK_DST" \
  --title "Off Grid v${NEW_VERSION}" \
  --notes-file "$NOTES_FILE"

# Announce the release in Slack — fail-soft, a chat message must never fail a published release.
# Webhook comes from .env.keygen locally (mirrors the SLACK_WEBHOOK_URL repo secret the CI release
# workflows use); notify-slack-release.mjs no-ops if it is unset.
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-$(sed -n 's/^SLACK_WEBHOOK_URL=//p' "$ROOT_DIR/.env.keygen" 2>/dev/null)}" \
  PRODUCT="Off Grid AI Mobile" VERSION="$NEW_VERSION" CHANNEL_LABEL="stable" \
  RELEASE_URL="$(gh release view "v${NEW_VERSION}" --json url -q .url 2>/dev/null)" NOTES_FILE="$NOTES_FILE" \
  node "$ROOT_DIR/scripts/notify-slack-release.mjs" || true

# Clean up temp file
rm -f "$NOTES_FILE"

echo ""
info "${BOLD}Release v${NEW_VERSION} published!${NC}"
echo ""
info "Artifacts:"
info "  APK (GitHub release): $APK_DST"
info "  AAB (Play Store):     $AAB_DST"
info ""
info "Next steps:"
info "  Android: Upload AAB to Play Console"
info ""
info "  GitHub: $(gh release view "v${NEW_VERSION}" --json url -q .url)"

# ── 6. Build iOS Archive ──────────────────────────────────────────
info "Building iOS archive..."
ARCHIVE_DIR="$ROOT_DIR/build"
ARCHIVE_PATH="$ARCHIVE_DIR/OffgridMobile-v${NEW_VERSION}.xcarchive"
mkdir -p "$ARCHIVE_DIR"

xcodebuild archive \
  -workspace ios/OffgridMobile.xcworkspace \
  -scheme OffgridMobile \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates

[ -d "$ARCHIVE_PATH" ] || error "iOS archive not found at $ARCHIVE_PATH"
info "iOS archive ready: $ARCHIVE_PATH"
info "  Open in Xcode to distribute: open \"$ARCHIVE_PATH\""
echo ""
info "iOS next step:"
info "  open \"$ARCHIVE_PATH\" → Distribute App in Xcode Organizer"
