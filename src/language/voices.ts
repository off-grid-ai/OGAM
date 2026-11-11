/**
 * Several voices for the language being learned. The phone usually has more than one voice for a language; using
 * only the first made every line sound like the same person. A speaker (or a sentence) gets a stable voice slot, and
 * the slot maps to one of the phone's installed offline voices for that language.
 */
import { listVoices, speakIn } from '../atlasVoice/tts';

const cache = new Map<string, Promise<string[]>>();

/** Names of the offline voices for a language, best quality first (empty when the phone has only one or none). */
export function voicesFor(code: string): Promise<string[]> {
  let found = cache.get(code);
  if (!found) {
    found = listVoices(code.split('-')[0])
      .then((all) => [...all].sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name)).map((v) => v.name).slice(0, 8))
      .catch(() => []);
    cache.set(code, found);
  }
  return found;
}

/** The voice for a slot ("" = the phone's default when it has no choice). */
export async function voiceForSlot(code: string, slot: number): Promise<string> {
  const names = await voicesFor(code);
  return names.length > 1 ? names[Math.abs(slot) % names.length] : '';
}

/** A steady slot for a piece of text, so the same sentence always has the same voice and different sentences vary. */
export function slotForText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 9973;
  return h;
}

/** Slots for the speakers of a dialogue in order of first appearance: the first speaker is slot 0, the next slot 1... */
export function speakerSlots(speakers: (string | undefined)[]): (s: string | undefined) => number {
  const order: string[] = [];
  for (const s of speakers) if (s && !order.includes(s)) order.push(s);
  return (s) => (s ? Math.max(0, order.indexOf(s)) : 0);
}

/** Speak a line of the language being learned in the voice its slot picks (a different voice for different sentences). */
export function speakVaried(text: string, code: string, tag: string): void {
  voiceForSlot(code, slotForText(text)).then((voice) => speakIn(text, code, { messageId: tag, voice })).catch(() => speakIn(text, code, { messageId: tag }));
}
