/**
 * RevenueCat public SDK keys.
 *
 * The production iOS/Android keys are intentionally NOT committed. Put the real keys in
 * your local working copy, then keep them out of git with:
 *
 *   git update-index --skip-worktree src/config/revenueCatKeys.ts
 *
 * (RevenueCat public SDK keys are not secret — they're extractable from any app binary —
 * but we keep the production keys out of the open-source repo as a hygiene measure.)
 *
 * Get the keys from the RevenueCat dashboard:
 *   - iOS key starts with 'appl_'
 *   - Android key starts with 'goog_'
 */
export const RC_API_KEY_IOS = 'appl_REPLACE_WITH_IOS_KEY';
export const RC_API_KEY_ANDROID = 'goog_REPLACE_WITH_ANDROID_KEY';

/**
 * RevenueCat Test Store key — public, safe to commit. Routes purchases through RC's
 * simulated store (no App Store / Play Store needed) for local flow testing. Only used
 * when USE_RC_TEST_STORE is true AND the build is __DEV__, so it can never reach production.
 */
export const RC_API_KEY_TEST_STORE = 'test_UDUmOVwoEWFUtYONRUfQOOjVisB';
export const USE_RC_TEST_STORE = false;
