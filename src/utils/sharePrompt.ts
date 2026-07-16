import { Linking } from 'react-native';
import { withUtm } from './utm';

// Star button (Settings + share sheet) points at the mobile repo specifically.
const GITHUB_URL = 'https://github.com/off-grid-ai/mobile';
// Community links (Settings "Stay in the loop" card + About screen). Single source of truth.
const FOLLOW_X_URL = 'https://x.com/alichherawalla';
const SLACK_INVITE_URL = 'https://join.slack.com/t/off-grid-mobile/shared_invite/zt-43kbisqxf-hM0y07EnaNnIfVN9DLR3Dg';
// The X share promotes the whole project, so it links to the org and early access.
// GitHub ignores UTM, so only the early-access link (our property) is tagged; the
// medium is the X share surface.
const ORG_GITHUB_URL = 'https://github.com/off-grid-ai';
const EARLY_ACCESS_URL = withUtm('https://getoffgridai.co/early-access/', 'x-share');

const SHARE_TEXT = `Off Grid AI is background intelligence for knowledge workers. It runs on your own hardware with no cloud round trips: it sees your day, remembers it, and gets ahead of you across phone and desktop. One mind across your devices, private by architecture, open source so you can check.

A chief of staff for $49/year or Life time $69. Intelligence, democratized.

Early access: ${EARLY_ACCESS_URL}
Open source: ${ORG_GITHUB_URL}`;

// The X Web Intent: opens a compose screen prefilled with the text, ready to
// post. x.com/intent/post is the current canonical endpoint (the legacy
// twitter.com/intent/tweet just 302-redirects to it), so we point straight at it.
const X_INTENT_URL = `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}`;

/** Open a pre-filled X (Twitter) compose screen, ready to post. */
export async function shareOnX(): Promise<void> {
  await Linking.openURL(X_INTENT_URL);
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
