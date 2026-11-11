/**
 * Spaced repetition (Leitner boxes). Every word starts in box 1. A right answer moves it up a
 * box and it comes back later; a wrong answer sends it back to box 1, due again now.
 */
/** `misses`: wrong answers not yet made up for (a right answer takes one off). It feeds the My mistakes list. */
export interface Memory { box: number; due: number; misses?: number }

/** Days until a word in each box is due again. */
export const INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
const DAY = 864e5;

export function remember(m: Memory | undefined, right: boolean, now = Date.now()): Memory {
  const box = right ? Math.min(5, (m?.box ?? 0) + 1) : 1;
  const misses = right ? Math.max(0, (m?.misses ?? 0) - 1) : (m?.misses ?? 0) + 1;
  return { box, due: right ? now + INTERVAL_DAYS[box] * DAY : now, ...(misses ? { misses } : {}) };
}

/** Items to review now: due ones first (weakest box first), up to `n`. */
export function dueItems<T extends { t: string }>(items: T[], memory: Record<string, Memory>, { n, now = Date.now() }: { n: number; now?: number }): T[] {
  const unique = items.filter((x, i) => items.findIndex((y) => y.t === x.t) === i);
  return unique
    .filter((x) => memory[x.t] && memory[x.t].due <= now)
    .sort((a, b) => memory[a.t].box - memory[b.t].box || memory[a.t].due - memory[b.t].due)
    .slice(0, n);
}
