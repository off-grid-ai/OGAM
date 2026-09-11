import { Linking, Platform } from 'react-native';

// Star button (Settings + share sheet) points at the mobile repo specifically.
const GITHUB_URL = 'https://github.com/off-grid-ai/mobile';
// Community links (Settings "Stay in the loop" card + About screen). Single source of truth.
const FOLLOW_X_URL = 'https://x.com/alichherawalla';
const SLACK_INVITE_URL = 'https://join.slack.com/t/off-grid-mobile/shared_invite/zt-3swt3s84k-R0CHRwISaUpExV2~3qUUdQ';

// Ratings live where the store ranks us, and each store only counts its own.
// iOS: the numeric App Store id, with action=write-review so the review sheet is
// already open on arrival rather than the listing.
// Android: market:// opens the Play app directly; the https form is the fallback
// for a device with no Play app (or a simulator), where market:// has no handler.
const APP_STORE_REVIEW_URL =
  'https://apps.apple.com/app/id6759299882?action=write-review';
const PLAY_PACKAGE = 'ai.offgridmobile';
const PLAY_MARKET_URL = `market://details?id=${PLAY_PACKAGE}`;
const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

/**
 * Open this platform's store review page - App Store on iOS, Play Store on Android.
 *
 * A rating only counts on the store the user installed from, so the destination follows the
 * platform rather than being one shared link.
 */
export async function rateOnStore(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL(APP_STORE_REVIEW_URL);
    return;
  }
  // canOpenURL rather than assuming: a device without the Play app (or an emulator image with no
  // Play services) has no market:// handler, and openURL would simply reject.
  const canOpenPlayApp = await Linking.canOpenURL(PLAY_MARKET_URL).catch(() => false);
  await Linking.openURL(canOpenPlayApp ? PLAY_MARKET_URL : PLAY_WEB_URL);
}

export { GITHUB_URL, FOLLOW_X_URL, SLACK_INVITE_URL };

type ShareVariant = 'text' | 'image';

// Shown at most ONCE per app session. In-memory only, so it naturally resets on
// relaunch (a new session). Replaces the old 2/10/20 count cadence, which re-showed
// the sheet several times per session.
let shownThisSession = false;

/** Clear the once-per-session guard (call on app launch; also used by tests). */
export function resetSharePromptSession(): void {
  shownThisSession = false;
}

/**
 * Schedule the "Support Open-Source AI" sheet — at most ONCE per app session, and
 * never after the user has already engaged it (that flag is persisted). Skips the
 * very first generation (count < 2) so it doesn't stack with first-run sheets. The
 * SINGLE trigger for both the text and image generation paths (no per-path cadence).
 */
export function maybeScheduleSharePrompt(opts: {
  variant: ShareVariant;
  count: number;
  hasEngaged: boolean;
  delayMs: number;
}): void {
  const { variant, count, hasEngaged, delayMs } = opts;
  if (hasEngaged || shownThisSession || count < 2) return;
  shownThisSession = true;
  setTimeout(() => emitSharePrompt(variant), delayMs);
}
type SharePromptListener = (variant: ShareVariant) => void;

const listeners = new Set<SharePromptListener>();

export function subscribeSharePrompt(
  listener: SharePromptListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSharePrompt(variant: ShareVariant): void {
  listeners.forEach(l => l(variant));
}
