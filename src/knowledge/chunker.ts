/**
 * Splits a document into study-sized chunks while keeping where each piece came from.
 *
 * Target 500-1,000 tokens a chunk (a token is about 4 characters), with a modest overlap (about 10%) between neighbours in the same
 * section. Breaks prefer section boundaries: a heading closes the chunk before it and no text is carried across, so a chunk
 * rarely mixes two sections. A table is kept whole (it is useless cut in half) even if that makes the chunk larger. Every chunk
 * records the first and last page it draws on, its section title and a position number, and its id is derived from the document's
 * hash, its position and its text, so chunking the same document again gives the same ids (nothing duplicates on a resume).
 *
 * The chunker is fed one page at a time and hands back chunks as they complete, so a 300-page book never sits in memory at once.
 */
import { SCHEMA_VERSION, type ChunkRecord } from './schema';
import { sha256Text } from './storage';

export interface ChunkerOptions { targetTokens: number; maxTokens: number; minTokens: number; overlapTokens: number }
export const DEFAULT_CHUNKER: ChunkerOptions = { targetTokens: 700, maxTokens: 1000, minTokens: 150, overlapTokens: 70 };
const CHARS_PER_TOKEN = 4;
export const approxTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const HEADING = [
  /^(chapter|part|section|unit|appendix)\s+([0-9]+|[ivxlc]+|[a-z])\b.{0,80}$/i,
  /^\d{1,2}(\.\d{1,2}){0,3}\s+[A-Z][^.!?]{2,80}$/,
  /^[A-Z][A-Z0-9 ,:&'-]{3,80}$/,
];
export const isHeading = (line: string): boolean => {
  const t = line.trim();
  return t.length >= 3 && t.length <= 90 && HEADING.some((r) => r.test(t)) && /[A-Za-z]{3}/.test(t);
};

/** Three or more consecutive lines laid out in columns (tabs, pipes, or runs of spaces) are a table. */
const isColumnLine = (line: string): boolean => /\t|\|/.test(line) || /\S {2,}\S+ {2,}\S/.test(line);

interface Block { text: string; page: number; heading?: boolean; table?: boolean }

/** Breaks one page into blocks: headings alone, tables whole, other text by paragraph. */
export function pageBlocks(page: number, text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.join(' ').trim()) blocks.push({ text: para.join('\n').trim(), page }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    if (isHeading(line)) { flush(); blocks.push({ text: line.trim(), page, heading: true }); continue; }
    if (isColumnLine(line)) {
      let j = i;
      while (j < lines.length && lines[j].trim() && isColumnLine(lines[j])) j++;
      if (j - i >= 3) { flush(); blocks.push({ text: lines.slice(i, j).join('\n'), page, table: true }); i = j - 1; continue; }
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Splits an over-long ordinary block at sentence ends so no piece passes the maximum. */
function splitLong(block: Block, maxChars: number): Block[] {
  if (block.table || block.heading || block.text.length <= maxChars) return [block];
  const sentences = block.text.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g) ?? [block.text];
  const out: Block[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > maxChars) { out.push({ ...block, text: cur.trim() }); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push({ ...block, text: cur.trim() });
  return out.flatMap((b) => (b.text.length > maxChars ? hardSplit(b, maxChars) : [b]));
}
function hardSplit(block: Block, maxChars: number): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < block.text.length; i += maxChars) out.push({ ...block, text: block.text.slice(i, i + maxChars) });
  return out;
}

export class Chunker {
  private ordinal = 0;
  private section: string | undefined;
  private cur: Block[] = [];
  private curChars = 0;
  private tail = '';

  constructor(private readonly doc: { sourceId: string; sourceHash: string }, private readonly opts: ChunkerOptions = DEFAULT_CHUNKER) {}

  /** Feed one page; returns any chunks that completed. */
  push(page: number, text: string): ChunkRecord[] {
    const out: ChunkRecord[] = [];
    const maxChars = this.opts.maxTokens * CHARS_PER_TOKEN;
    const targetChars = this.opts.targetTokens * CHARS_PER_TOKEN;
    for (const raw of pageBlocks(page, text)) {
      for (const block of splitLong(raw, maxChars)) {
        // A new section closes the chunk before it, if that chunk is worth keeping, and nothing is carried over the boundary.
        if (block.heading) {
          if (this.curChars >= this.opts.minTokens * CHARS_PER_TOKEN) out.push(this.emit(false));
          this.section = block.text;
          this.cur.push(block); this.curChars += block.text.length;
          continue;
        }
        // A table never shares a chunk with ordinary text it would crowd; it is closed off whole.
        if (block.table) {
          if (this.curChars > 0 && this.curChars + block.text.length > maxChars) out.push(this.emit(true));
          this.cur.push(block); this.curChars += block.text.length;
          if (this.curChars >= targetChars) out.push(this.emit(false));
          continue;
        }
        if (this.curChars > 0 && this.curChars + block.text.length > targetChars) out.push(this.emit(true));
        this.cur.push(block); this.curChars += block.text.length;
      }
    }
    return out;
  }

  /** After the last page: the chunk still being built. */
  flush(): ChunkRecord[] {
    return this.curChars > 0 ? [this.emit(false)] : [];
  }

  private emit(carryOverlap: boolean): ChunkRecord {
    const body = this.cur.map((b) => b.text).join('\n\n');
    const text = (this.tail ? `${this.tail}\n\n` : '') + body;
    const contentBlocks = this.cur.filter((b) => !b.heading || this.cur.length === 1);
    const pages = (contentBlocks.length ? contentBlocks : this.cur).map((b) => b.page);
    const table = this.cur.some((b) => b.table);
    const ordinal = this.ordinal++;
    const chunk: ChunkRecord = {
      schemaVersion: SCHEMA_VERSION,
      chunkId: `ch-${sha256Text(`${this.doc.sourceHash}:${ordinal}:${text}`).slice(0, 24)}`,
      sourceId: this.doc.sourceId, sourceHash: this.doc.sourceHash, ordinal,
      page: Math.min(...pages), pageEnd: Math.max(...pages),
      ...(this.sectionFor() ? { section: this.sectionFor() } : {}),
      tokens: approxTokens(text), text, ...(table ? { table: true } : {}),
    };
    // Overlap: the last sentences of this chunk start the next, only inside one section and never after a table.
    this.tail = carryOverlap && !table ? this.overlapOf(body) : '';
    this.cur = []; this.curChars = 0;
    return chunk;
  }

  private sectionFor(): string | undefined {
    const heading = this.cur.find((b) => b.heading);
    return heading ? heading.text : this.section;
  }

  private overlapOf(body: string): string {
    const want = this.opts.overlapTokens * CHARS_PER_TOKEN;
    const tail = body.slice(-want * 2);
    const sentences = tail.match(/[^.!?\n]+[.!?]+["')\]]*\s*/g);
    if (!sentences) return '';
    let out = '';
    for (let i = sentences.length - 1; i >= 0 && out.length + sentences[i].length <= want; i--) out = sentences[i] + out;
    return out.trim();
  }
}

/** Whole-array convenience for tests and small documents. */
export function chunkPages(doc: { sourceId: string; sourceHash: string }, pages: Array<{ page: number; text: string }>, opts?: ChunkerOptions): ChunkRecord[] {
  const chunker = new Chunker(doc, opts);
  const out: ChunkRecord[] = [];
  for (const p of pages) out.push(...chunker.push(p.page, p.text));
  out.push(...chunker.flush());
  return out;
}
