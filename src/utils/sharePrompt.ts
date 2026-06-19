const GITHUB_URL = 'https://github.com/off-grid-ai/mobile';

const SHARE_TEXT = `Just tried Off Grid - a completely free, open-source AI that runs 100% on your phone. No cloud, no subscriptions, no data leaving your device.

If you believe everyone should have access to private AI, check it out

${GITHUB_URL}`;

export const SHARE_ON_X_URL = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
  SHARE_TEXT,
)}`;
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
