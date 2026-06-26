import { useAppStore } from '../stores/appStore';

// Fires at count 3, then every 10 starting at 15 (3, 15, 25, 35...)
// Share sheet fires at 2, 10, 20, 30... so these never collide
const PRO_AHA_THRESHOLD = 3;
const PRO_AHA_REPEAT_START = 15;
const PRO_AHA_REPEAT_INTERVAL = 10;

export function shouldShowProAha(count: number): boolean {
  if (count === PRO_AHA_THRESHOLD) return true;
  if (count >= PRO_AHA_REPEAT_START && (count - PRO_AHA_REPEAT_START) % PRO_AHA_REPEAT_INTERVAL === 0) return true;
  return false;
}

type ProPromptVariant = 'text' | 'image';
type ProPromptListener = (variant: ProPromptVariant) => void;

const listeners = new Set<ProPromptListener>();

export function subscribeProPrompt(listener: ProPromptListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitProPrompt(variant: ProPromptVariant): void {
  listeners.forEach(l => l(variant));
}

// Called by generationService after each completed text response
export function checkProPromptForText(delayMs: number): void {
  const s = useAppStore.getState();
  if (s.hasRegisteredPro) return;
  if (s.proAhaTriggeredBy !== null) return;
  if (!shouldShowProAha(s.textGenerationCount)) return;
  s.setProAhaTriggeredBy('text');
  setTimeout(() => emitProPrompt('text'), delayMs);
}

// Called by imageGenerationService after each completed image generation
export function checkProPromptForImage(delayMs: number): void {
  const s = useAppStore.getState();
  if (s.hasRegisteredPro) return;
  if (s.proAhaTriggeredBy !== null) return;
  if (!shouldShowProAha(s.imageGenerationCount)) return;
  s.setProAhaTriggeredBy('image');
  setTimeout(() => emitProPrompt('image'), delayMs);
}
