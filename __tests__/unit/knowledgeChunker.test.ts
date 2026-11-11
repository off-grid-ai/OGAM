import { Chunker, chunkPages, approxTokens } from '../../src/knowledge/chunker';
import { validateChunk } from '../../src/knowledge/schema';

const DOC = { sourceId: 'src-1', sourceHash: 'e'.repeat(64) };
const sentence = (n: number, topic: string) => `${topic} point ${n} explains how the idea works in practice and why it matters for the reader.`;
const paragraph = (topic: string, start: number, count = 6) => Array.from({ length: count }, (_, i) => sentence(start + i, topic)).join(' ');
const pageOf = (topic: string, p: number) => [paragraph(topic, p * 10), paragraph(topic, p * 10 + 6), paragraph(topic, p * 10 + 12)].join('\n\n');

/** A small "book": three chapters of several pages each, with a table on page 7. */
function book() {
  const pages: Array<{ page: number; text: string }> = [];
  const chapter = (title: string, first: number, last: number, topic: string) => {
    for (let p = first; p <= last; p++) pages.push({ page: p, text: (p === first ? `${title}\n\n` : '') + pageOf(topic, p) });
  };
  chapter('Chapter 1 Accounting Basics', 1, 4, 'ledger');
  chapter('Chapter 2 Financial Statements', 5, 8, 'statement');
  chapter('Chapter 3 Cost Accounting', 9, 12, 'costing');
  pages[6].text += '\n\nItem\tQ1\tQ2\tQ3\nRevenue\t100\t120\t130\nExpenses\t80\t90\t95\nProfit\t20\t30\t35';
  return pages;
}

describe('knowledge chunker', () => {
  const chunks = chunkPages(DOC, book());

  it('makes valid chunks of study size and numbers them in order', () => {
    expect(chunks.length).toBeGreaterThan(6);
    chunks.forEach((c, i) => { expect(validateChunk(c)).toEqual([]); expect(c.ordinal).toBe(i); });
    const inRange = chunks.filter((c) => c.tokens >= 150 && c.tokens <= 1100);
    expect(inRange.length).toBeGreaterThanOrEqual(chunks.length - 3); // only section ends may be short
    expect(Math.max(...chunks.filter((c) => !c.table).map((c) => c.tokens))).toBeLessThanOrEqual(1100);
  });

  it('keeps each chunk on the pages it came from and the chapter it belongs to', () => {
    for (const c of chunks) {
      expect(c.page).toBeLessThanOrEqual(c.pageEnd);
      if (c.section?.startsWith('Chapter 1')) expect(c.pageEnd).toBeLessThanOrEqual(4);
      if (c.section?.startsWith('Chapter 2')) { expect(c.page).toBeGreaterThanOrEqual(5); expect(c.pageEnd).toBeLessThanOrEqual(8); }
      if (c.section?.startsWith('Chapter 3')) expect(c.page).toBeGreaterThanOrEqual(9);
    }
    expect(new Set(chunks.map((c) => c.section?.split(' ').slice(0, 2).join(' ')))).toEqual(new Set(['Chapter 1', 'Chapter 2', 'Chapter 3']));
    expect(chunks[0].page).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(12);
  });

  it('does not mix chapters: a chapter heading starts a new chunk and nothing is carried across it', () => {
    const starts = chunks.filter((c) => /^Chapter [23]/.test(c.text));
    expect(starts).toHaveLength(2);
    for (const c of starts) expect(c.text.startsWith('Chapter')).toBe(true);
  });

  it('keeps a table whole inside one chunk, with its page', () => {
    const t = chunks.find((c) => c.table);
    expect(t).toBeDefined();
    expect(t!.text).toContain('Item\tQ1\tQ2\tQ3');
    expect(t!.text).toContain('Profit\t20\t30\t35');
    expect(t!.page).toBeLessThanOrEqual(7);
    expect(t!.pageEnd).toBeGreaterThanOrEqual(7);
  });

  it('overlaps neighbours inside a section a little, and gives the same ids every time (so a resume duplicates nothing)', () => {
    const same = chunks.filter((c, i) => i > 0 && c.section === chunks[i - 1].section && !c.table && !chunks[i - 1].table && !/^Chapter/.test(c.text));
    expect(same.length).toBeGreaterThan(0);
    const overlapping = same.filter((c) => { const prev = chunks[c.ordinal - 1]; const head = c.text.slice(0, 80); return prev.text.includes(head); });
    expect(overlapping.length).toBeGreaterThan(0);
    const again = chunkPages(DOC, book());
    expect(again.map((c) => c.chunkId)).toEqual(chunks.map((c) => c.chunkId));
    expect(new Set(chunks.map((c) => c.chunkId)).size).toBe(chunks.length);
  });

  it('is fed page by page and hands chunks back as they complete, never holding the whole document', () => {
    const chunker = new Chunker(DOC);
    let maxBuffered = 0;
    const out: string[] = [];
    for (const p of book()) {
      for (const c of chunker.push(p.page, p.text)) out.push(c.chunkId);
      maxBuffered = Math.max(maxBuffered, (chunker as any).curChars);
    }
    out.push(...chunker.flush().map((c) => c.chunkId));
    expect(out).toEqual(chunks.map((c) => c.chunkId));
    expect(maxBuffered).toBeLessThan(approxTokens('x'.repeat(5000)) * 4 * 2); // a chunk or two, not the book
  });
});
