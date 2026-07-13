import { Linking } from 'react-native';
import { withUtm } from './utm';

// Star button (Settings + share sheet) points at the mobile repo specifically.
const GITHUB_URL = 'https://github.com/off-grid-ai/mobile';
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

export { GITHUB_URL };

export function shouldShowSharePrompt(count: number): boolean {
  // Skip on first text generation (count === 1) to avoid stacking with other sheets
  // Show on: 2nd text (count === 2), every 10th text (count % 10 === 0), or any image generation
  return count > 1 && ((count > 0 && count % 10 === 0) || count === 2);
}

type ShareVariant = 'text' | 'image';
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
