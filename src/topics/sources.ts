/**
 * Sources for a topic course: pages the AI finds online (you choose which to keep), notes you paste and text files you pick.
 * Squares are then written from the best-matching passages of these instead of from the model's memory alone.
 * The pure parts (matching a square to passages, reading the AI's picks) are tested without a device.
 */
import { str } from '../study/games/json';

export interface CourseSource {
  id: string;
  title: string;
  /** web: found online. note: pasted. file: a text file. */
  kind: 'web' | 'note' | 'file';
  url?: string;
  text: string;
  addedAt: number;
}

export interface Candidate { title: string; snippet: string; url: string }

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'are', 'you', 'your', 'about', 'into', 'its', 'can', 'will', 'use', 'using']);
const words = (text: string) => (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));

/** Passages of about [size] characters, cut at paragraph or sentence ends. */
export function passages(text: string, size = 600): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of text.replace(/\r/g, '').split(/\n{2,}|(?<=[.!?])\s+/)) {
    if (!piece.trim()) continue;
    if ((current + piece).length > size && current) { out.push(current.trim()); current = ''; }
    current += `${piece} `;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The passages of all sources that best match what a square covers, within a character budget. */
export function relevantExcerpts(sources: CourseSource[], query: string, maxChars = 1800): { source: string; text: string }[] {
  const want = new Set(words(query));
  if (!want.size) return [];
  const scored: { source: string; text: string; score: number }[] = [];
  for (const s of sources) {
    for (const p of passages(s.text)) {
      const have = new Set(words(p));
      let shared = 0;
      want.forEach((w) => { if (have.has(w)) shared++; });
      if (shared >= 2) scored.push({ source: s.title, text: p, score: shared / Math.sqrt(have.size + 1) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: { source: string; text: string }[] = [];
  let used = 0;
  for (const c of scored) {
    if (used + c.text.length > maxChars) continue;
    out.push({ source: c.source, text: c.text });
    used += c.text.length;
    if (out.length >= 4) break;
  }
  return out;
}

/** The question put to the AI: which of these search results are the best to learn from. */
export function pickPrompt(ask: { topic: string; goal: string; found: Candidate[]; keep?: number }) {
  const { topic, goal, found, keep = 4 } = ask;
  return {
    system: 'You choose good learning sources. Answer only with numbers.',
    user: `A learner wants to study: ${topic}${goal ? ` (goal: ${goal})` : ''}.
Pick the ${keep} search results that look most useful and trustworthy for learning it: prefer documentation, universities, textbooks, established educational sites and clear explainers; avoid ads, shops, forums and thin pages.
${found.map((c, i) => `${i + 1}. ${c.title} - ${c.snippet.slice(0, 160)} (${c.url})`).join('\n')}
Reply with the numbers of the ${keep} best, separated by commas.`,
  };
}

/** The positions the AI picked (zero-based), in its order, without repeats. */
export function parsePicks(reply: string, count: number): number[] {
  const out: number[] = [];
  for (const m of reply.matchAll(/\d+/g)) {
    const n = Number(m[0]) - 1;
    if (n >= 0 && n < count && !out.includes(n)) out.push(n);
  }
  return out;
}

/** A note or file turned into a source. */
export const makeSource = (s: { title: string; kind: CourseSource['kind']; text: string; url?: string }, id: string): CourseSource =>
  ({ id, title: str(s.title, 80) || 'Untitled', kind: s.kind, url: s.url, text: s.text.replace(/\s+\n/g, '\n').slice(0, 12000), addedAt: Date.now() });

export const MAX_SOURCES = 12;
