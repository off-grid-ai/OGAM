/**
 * A message longer than the model can hold is read in parts: each part is read on its own and reduced to short notes, and the
 * model then answers from the start of the message, the notes, and the end of the message (where the request usually is). The
 * saved message is never changed; only what the model is shown. Pure apart from the `ask` function it is given, so it is tested
 * without a device.
 */
export const MAX_PARTS = 12;
const EDGE_CHARS = 600;
const CHARS_PER_TOKEN = 3;

/** Whether a message is too long for the context: it would take more than 60% of it. */
export function needsReadingInParts(text: string, contextTokens: number): boolean {
  return text.length > contextTokens * CHARS_PER_TOKEN * 0.6;
}

/** How much of the text one part may hold: 30% of the context, leaving room for the request, the prompt and the notes. */
export const partChars = (contextTokens: number): number => Math.max(1500, Math.floor(contextTokens * CHARS_PER_TOKEN * 0.3));

/** Cuts text into parts of at most `max` characters, at paragraph or line breaks where it can. */
export function splitIntoParts(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
    const at = cut > max * 0.5 ? cut + 1 : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface ReadInPartsOptions {
  text: string;
  contextTokens: number;
  /** Runs the model on one prompt and returns its answer. */
  ask: (system: string, user: string) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
}

/** The text the model is shown instead of the long message, or null when it needs no help or cannot be read in parts. */
export async function readInParts(o: ReadInPartsOptions): Promise<string | null> {
  if (!needsReadingInParts(o.text, o.contextTokens)) return null;
  const head = o.text.slice(0, EDGE_CHARS).trim();
  const tail = o.text.slice(-EDGE_CHARS).trim();
  const middle = o.text.slice(EDGE_CHARS, Math.max(EDGE_CHARS, o.text.length - EDGE_CHARS));
  const parts = splitIntoParts(middle, partChars(o.contextTokens));
  const read = parts.slice(0, MAX_PARTS);
  const notes: string[] = [];
  for (let i = 0; i < read.length; i++) {
    if (o.shouldStop?.()) return null;
    o.onProgress?.(i, read.length);
    const note = (await o.ask(
      'You read one part of a long text and write short notes on it. Never invent anything that is not in the part.',
      `THE USER'S REQUEST (the start and the end of their message):\n${head}\n...\n${tail}\n\nPART ${i + 1} OF ${read.length}:\n${read[i]}\n\nWrite brief notes (at most 120 words) on what in this part matters for the request. Keep names, numbers and dates exactly as written. If nothing matters, write "nothing relevant".`,
    )).trim();
    if (note && !/^nothing relevant\.?$/i.test(note)) notes.push(`Part ${i + 1}: ${note}`);
  }
  o.onProgress?.(read.length, read.length);
  const skipped = parts.length - read.length;
  return [
    head,
    `[Atlas read the rest of this long message in ${read.length} parts and kept these notes${skipped > 0 ? `; ${skipped} more parts were too much to read` : ''}.]`,
    notes.length ? notes.join('\n') : '(Nothing in the middle of the message mattered for the request.)',
    '[The end of the message:]',
    tail,
  ].join('\n\n');
}
