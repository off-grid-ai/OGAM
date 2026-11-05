/**
 * One citation format for chat, study results, briefings and exercises: title, page or section, link, date read and the exact quote.
 * A citation is "verified" only when its quote really appears in the source text it points to; anything else is shown as unverified.
 */
export interface Citation { title: string; page?: number; section?: string; url?: string; readAt?: string; quote: string; author?: string; year?: string; publisher?: string }
export type CheckedCitation = Citation & { verified: boolean };

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** True when the quote (ignoring case, spacing and curly quotes) appears in the source text. Very short quotes never verify. */
export const quoteAppears = (quote: string, sourceText: string): boolean => {
  const q = squash(quote);
  return q.length >= 12 && squash(sourceText).includes(q);
};

/** Marks each citation verified or not against the text of the source it names. `lookup` returns that text, or undefined if the source is not available. */
export function verifyCitations(cites: Citation[], lookup: (c: Citation) => string | undefined): CheckedCitation[] {
  return cites.map((c) => { const text = lookup(c); return { ...c, verified: text !== undefined && quoteAppears(c.quote, text) }; });
}

const dateOf = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
const where = (c: Citation) => [c.page ? `p. ${c.page}` : '', c.section ?? ''].filter(Boolean).join(', ');

/** A numbered reference list. Unverified entries are labelled; no field is invented when it is missing. */
export function referenceList(cites: CheckedCitation[]): string {
  if (!cites.length) return 'No sources: this answer is not backed by any document or page.';
  return cites.map((c, i) => {
    const bits = [c.author, c.year ? `(${c.year})` : '', c.title, c.publisher, where(c), c.url, dateOf(c.readAt) ? `read ${dateOf(c.readAt)}` : ''].filter(Boolean).join('. ');
    return `[${i + 1}] ${bits}. "${c.quote}"${c.verified ? '' : ' (quote not found in the source: unverified)'}`;
  }).join('\n');
}

/** APA 7 reference entry from the fields we really have. Missing author/year are shown as n.d. / title-first, never guessed. */
export function apaReference(c: Citation): string {
  const who = c.author?.trim() || c.title;
  const year = c.year?.trim() || 'n.d.';
  const title = c.author ? `${c.title}.` : '';
  return [`${who}${who.endsWith('.') ? '' : '.'}`, `(${year}).`, title, c.publisher ? `${c.publisher}.` : '', c.url ?? ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** In-text APA citation: (Author, year, p. N). */
export const apaInText = (c: Citation): string => `(${c.author ? c.author.split(',')[0] : c.title}, ${c.year || 'n.d.'}${c.page ? `, p. ${c.page}` : ''})`;

/** A line to put under an answer saying how well it is backed. */
export function sourceStatus(cites: CheckedCitation[]): string {
  if (!cites.length) return 'No source: written from the model\'s general knowledge, not checked against your documents.';
  const ok = cites.filter((c) => c.verified).length;
  return ok === cites.length ? `${ok} source${ok === 1 ? '' : 's'}, all quotes found.` : `${ok} of ${cites.length} quotes found in the source; the rest are unverified.`;
}

/** Sources from a web-search tool result ("1. [Title](url)\n   snippet"). The snippet is the quote; it is the search engine's text, so it is not marked verified. */
export function sourcesFromSearch(content: string): CheckedCitation[] {
  const out: CheckedCitation[] = [];
  const re = /^\s*\d+\.\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*\n\s*([^\n]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push({ title: m[1].trim(), url: m[2], quote: m[3].trim(), verified: false });
  return out;
}
export const hostOf = (url?: string): string => (url ? url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '');
