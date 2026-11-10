/**
 * Source numbers in a reply. When the model cites a search result as [1], the number is shown as a small raised digit in the
 * text, and the sources are listed under the reply (1, 2, 3...) so each can be opened. Pure, so it is tested without a device.
 */
import { sourcesFromSearch, type CheckedCitation } from './citations';

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
export const superscript = (n: number): string => String(n).split('').map((d) => SUP[Number(d)]).join('');

/** Numbers cited in the text as [n], for n from 1 to `count` (a link like [1](url) is not a citation). */
export function citedNumbers(text: string, count: number): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,2})\](?!\()/g)) { const n = Number(m[1]); if (n >= 1 && n <= count) found.add(n); }
  return [...found].sort((a, b) => a - b);
}

/** The text with each [n] that names one of `count` sources shown as a small raised number; anything else is left alone. */
export function markSources(text: string, count: number): string {
  if (count < 1) return text;
  return text.replace(/\s?\[(\d{1,2})\](?!\()/g, (whole, d) => {
    const n = Number(d);
    return n >= 1 && n <= count ? superscript(n) : whole;
  });
}

type Turn = Array<{ id: string; role: string; toolName?: string; content: string }>;

/** The numbered sources of the latest web search in the turn that led to this reply (up to the user message before it). */
export function sourcesBefore(messages: Turn, replyId: string): CheckedCitation[] {
  const at = messages.findIndex((m) => m.id === replyId);
  for (let j = at - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role === 'user') break;
    if (m.role === 'tool' && m.toolName === 'web_search') return sourcesFromSearch(m.content);
  }
  return [];
}
