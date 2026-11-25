import InAppReview from 'react-native-in-app-review';
import { openStoreListing, ratingStore } from './ratingStore';

// Star button (Settings) points at the mobile repo specifically.
const GITHUB_URL = 'https://github.com/off-grid-ai/mobile';
// Community links (Settings "Stay in the loop" card + About screen). Single source of truth.
const FOLLOW_X_URL = 'https://x.com/alichherawalla';
const SLACK_INVITE_URL =
  'https://join.slack.com/t/off-grid-mobile/shared_invite/zt-494gbuv5c-kj9tT7U0AS8Kq8UUO63_jw';

/**
 * Open the review page of the store that installed the app (see ratingStore): a rating only counts
 * on that store.
 */
export async function rateOnStore(): Promise<void> {
  await openStoreListing(await ratingStore());
}

/** How a rating ask was answered: the store's own dialog, or the store page as a fallback. */
export type ReviewRoute = 'native' | 'store_link';

/**
 * Ask for a rating with the store's own dialog: SKStoreReviewController on iOS, the Play In-App
 * Review API on Android. The person rates without leaving the app.
 *
 * Falls back to the installing store's page when the dialog cannot show: no native module, an install
 * Play did not make, or the request itself failing.
 */
export async function requestStoreReview(): Promise<ReviewRoute> {
  const store = await ratingStore();
  // The dialog is the App Store's or Play's own; Play's shows only for a build Play installed.
  if (store.nativeReview && InAppReview.isAvailable()) {
    try {
      await InAppReview.RequestInAppReview();
      return 'native';
    } catch {
      // Fall through to the store page.
    }
  }
  await openStoreListing(store);
  return 'store_link';
}

export { GITHUB_URL, FOLLOW_X_URL, SLACK_INVITE_URL };

export type ShareVariant = 'text' | 'image';

// Shown at most ONCE per app session. In-memory only, so it naturally resets on
// relaunch (a new session). Replaces the old 2/10/20 count cadence, which re-showed
// the sheet several times per session.
let shownThisSession = false;

/** Clear the once-per-session guard (call on app launch; also used by tests). */
export function resetSharePromptSession(): void {
  shownThisSession = false;
  goodTurnsInARow = 0;
}

// Good replies in a row this session. A failed or refused turn, or a stopped reply, starts it again,
// so the ask only ever follows things that worked.
const GOOD_TURNS_BEFORE_ASK = 3;
let goodTurnsInARow = 0;

/** A turn that did not work (an error, a memory refusal) or was stopped: the ask waits for a new run. */
export function noteTurnNotGood(): void {
  goodTurnsInARow = 0;
}

/**
 * A reply or image that worked. Schedules the rating ask after the third good one in a row - at most
 * ONCE per app session, and never after the user has rated or chosen "Don't ask again" (that flag is
 * persisted). The SINGLE trigger for both the text and image generation paths.
 */
export function maybeScheduleSharePrompt(opts: {
  variant: ShareVariant;
  hasEngaged: boolean;
  delayMs: number;
}): void {
  const { variant, hasEngaged, delayMs } = opts;
  goodTurnsInARow += 1;
  if (hasEngaged || shownThisSession || goodTurnsInARow < GOOD_TURNS_BEFORE_ASK) return;
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
